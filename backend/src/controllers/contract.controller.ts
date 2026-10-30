import { Request, Response } from 'express';
import { Types } from 'mongoose';
import fs from 'fs';

import ContractModel from '../models/contract.model';
import ContractChunkModel from '../models/contract-chunks.model';
import { extractTextFromPDF, splitIntoChunks } from '../services/pdfParser.service';
import { getEmbedding, TaskType } from '../services/aiClient.service';
import { uploadContractPDF, deleteContractPDF, getSignedContractPDFUrl } from '../services/storage.service';
import { AppError } from '../middleware/errorHandler.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { MAX_FILE_SIZE } from '../middleware/upload.middleware';

/**
 * Helper: Ensures file data is available as a Buffer regardless of whether
 * Multer was configured with memoryStorage or diskStorage.
 */
const getFileBuffer = async (file: Express.Multer.File): Promise<Buffer> => {
  if (file.buffer && Buffer.isBuffer(file.buffer)) {
    return file.buffer;
  }

  if (file.path && fs.existsSync(file.path)) {
    return await fs.promises.readFile(file.path);
  }

  throw new AppError('Unable to read uploaded file data from storage.', 400);
};

/**
 * Helper: Safely cleans up temporary files created on disk if diskStorage was used.
 */
const cleanTempDiskFile = async (filePath?: string): Promise<void> => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (err: any) {
    console.error(`Failed to remove temporary disk file at "${filePath}":`, err?.message || err);
  }
};

/**
 * Controller: Handles contract upload, text extraction, chunking,
 * cloud storage persistence (Cloudinary), embedding generation, and vector persistence.
 *
 * Pipeline:
 * 1. Validates that a PDF file was uploaded.
 * 2. Checks file MIME-type, extension, and enforces size limit.
 * 3. Retrieves authenticated user ID from req.userId.
 * 4. Extracts text from the PDF using pdfParser.service (serving as structural validation).
 * 5. Splits the text into overlapping chunks using splitIntoChunks.
 * 6. Uploads the PDF buffer to Cloudinary (private/authenticated storage) via storage.service.
 * 7. Creates a Contract document in MongoDB with status 'processing'.
 * 8. Generates vector embeddings for each chunk sequentially via aiClient.service (TaskType.RETRIEVAL_DOCUMENT).
 * 9. Saves all chunk records in MongoDB using ContractChunk model.
 * 10. Updates contract status to 'ready' on success.
 * 11. On failure: removes the uploaded Cloudinary asset, deletes contract chunks,
 *     updates contract status to 'failed', and preserves the original error without swallowing it.
 */
export const uploadContract = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // 1. Validate file presence
  if (!req.file) {
    throw new AppError('No file uploaded. Please upload a PDF contract file.', 400);
  }

  const file = req.file;

  // 2. Validate file type (MIME-type and extension checks)
  const isPdfMime = file.mimetype.toLowerCase() === 'application/pdf';
  const hasPdfExtension = file.originalname.toLowerCase().endsWith('.pdf');

  if (!isPdfMime || !hasPdfExtension) {
    await cleanTempDiskFile(file.path);
    throw new AppError('Invalid file format. Only PDF documents are supported.', 400);
  }

  // Enforce maximum file size using imported MAX_FILE_SIZE
  if (file.size > MAX_FILE_SIZE) {
    await cleanTempDiskFile(file.path);
    throw new AppError(
      `File size exceeds the limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      400
    );
  }

  // 3. Validate authenticated user
  const userId = req.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    await cleanTempDiskFile(file.path);
    throw new AppError('Unauthorized: A valid authenticated user ID is required.', 401);
  }

  // 4. Retrieve buffer
  const fileBuffer = await getFileBuffer(file);
  if (fileBuffer.length === 0) {
    await cleanTempDiskFile(file.path);
    throw new AppError('The uploaded PDF file is empty.', 400);
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    await cleanTempDiskFile(file.path);
    throw new AppError(
      `File size exceeds the limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      400
    );
  }

  // 5. Extract text from PDF (serves as additional validity check of PDF structure)
  let extractedText: string;
  try {
    extractedText = await extractTextFromPDF(fileBuffer);
  } catch (extractionError: any) {
    await cleanTempDiskFile(file.path);
    throw new AppError(
      extractionError.message || 'PDF text extraction failed. File may be corrupted or unreadable.',
      400
    );
  }

  // 6. Split extracted text into chunks
  const textChunks = splitIntoChunks(extractedText);
  if (!textChunks || textChunks.length === 0) {
    await cleanTempDiskFile(file.path);
    throw new AppError('No extractable text chunks could be generated from the PDF.', 400);
  }

  // 7. Upload to Cloudinary (Protected/Authenticated storage)
  // Streams buffer directly from memory to Cloudinary without permanent local disk storage
  let uploadedPublicId: string | undefined;
  let fileURL: string;
  try {
    const uploadResult = await uploadContractPDF(fileBuffer, file.originalname);
    uploadedPublicId = uploadResult.publicId;
    fileURL = uploadResult.secureUrl;
  } catch (cloudUploadError: any) {
    await cleanTempDiskFile(file.path);
    throw cloudUploadError;
  } finally {
    // If a temporary disk file was created by an external Multer diskStorage, clean it up now
    await cleanTempDiskFile(file.path);
  }

  // 8. Create initial Contract record with 'processing' status
  let contract;
  try {
    contract = await ContractModel.create({
      userId: new Types.ObjectId(userId),
      fileName: file.originalname,
      originalFileURL: fileURL,
      cloudinaryPublicId: uploadedPublicId,
      status: 'processing',
      flaggedRisks: [],
    });
  } catch (dbError: any) {
    // Clean up uploaded cloud asset if database record creation fails
    if (uploadedPublicId) {
      await deleteContractPDF(uploadedPublicId);
    }
    throw new AppError(
      `Failed to initialize contract in database: ${dbError?.message || 'Database error'}`,
      500
    );
  }

  // 9. Generate embeddings and persist chunks with robust error cleanup
  try {
    const chunkDocs: Array<{
      contractId: Types.ObjectId;
      chunkText: string;
      chunkIndex: number;
      embedding: number[];
    }> = [];

    // Generate embeddings sequentially using RETRIEVAL_DOCUMENT task type
    for (let i = 0; i < textChunks.length; i++) {
      const chunkText = textChunks[i];
      const embedding = await getEmbedding(chunkText, TaskType.RETRIEVAL_DOCUMENT);

      chunkDocs.push({
        contractId: contract._id as Types.ObjectId,
        chunkText,
        chunkIndex: i,
        embedding,
      });
    }

    // Persist all chunk documents
    await ContractChunkModel.insertMany(chunkDocs);

    // Update contract status to 'ready'
    contract.status = 'ready';
    await contract.save();

    // 10. Send success response
    res.status(201).json({
      success: true,
      message: 'Contract uploaded and processed successfully.',
      contractId: contract._id,
      fileName: contract.fileName,
      status: contract.status,
      chunksCount: chunkDocs.length,
    });
  } catch (processingError: any) {
    // Robust Failure Handling: Attempt cleanup steps independently
    // Step A: Delete any partially inserted chunks for this contract
    try {
      await ContractChunkModel.deleteMany({ contractId: contract._id });
    } catch (cleanupErr: any) {
      console.error('Failed to clean up contract chunks after processing error:', cleanupErr?.message || cleanupErr);
    }

    // Step B: Update contract status to 'failed'
    try {
      await ContractModel.findByIdAndUpdate(contract._id, { status: 'failed' });
    } catch (statusErr: any) {
      console.error('Failed to update contract status to failed:', statusErr?.message || statusErr);
    }

    // Step C: Remove the uploaded cloud asset
    if (uploadedPublicId) {
      await deleteContractPDF(uploadedPublicId);
    }

    // Step D: Preserve and re-throw the original processing error without swallowing it
    if (processingError instanceof AppError) {
      throw processingError;
    }
    throw new AppError(
      `Contract processing failed: ${processingError.message || 'Unknown processing error'}`,
      500
    );
  }
});

/**
 * Controller: Retrieves a concise list of all contracts belonging to the authenticated user.
 *
 * Pipeline:
 * 1. Retrieves and validates the authenticated user ID from req.userId.
 * 2. Queries ContractModel for records where userId matches the authenticated user.
 * 3. Restricts returned fields to _id, fileName, status, and createdAt.
 * 4. Sorts results in descending order by createdAt (newest first).
 * 5. Returns a consistent JSON response.
 */
export const getUserContracts = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // 1. Validate authenticated user
  const userId = req.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new AppError('Unauthorized: A valid authenticated user ID is required.', 401);
  }

  // 2. Fetch user's contracts, projecting only necessary fields and sorting newest first
  const contracts = await ContractModel.find({
    userId: new Types.ObjectId(userId),
  })
    .select('_id fileName status createdAt')
    .sort({ createdAt: -1 })
    .lean();

  // 3. Return concise list of contracts
  res.status(200).json({
    success: true,
    contracts,
  });
});

/**
 * Controller: Retrieves details for a specific contract belonging to the authenticated user.
 *
 * Pipeline:
 * 1. Validates authenticated user ID from req.userId (401 if missing or invalid).
 * 2. Validates contractId parameter from req.params.contractId (400 if invalid).
 * 3. Finds contract matching BOTH _id and userId (preventing unauthorized cross-user access).
 * 4. Selects only safe, necessary fields (_id, fileName, status, flaggedRisks, createdAt, updatedAt).
 * 5. Returns 404 if not found, or 200 with { success: true, contract }.
 */
export const getContractById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // 1. Validate authenticated user ID
  const userId = req.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new AppError('Unauthorized: A valid authenticated user ID is required.', 401);
  }

  // 2. Validate contract ID from request params
  const { contractId } = req.params;
  if (!contractId || typeof contractId !== 'string' || !Types.ObjectId.isValid(contractId)) {
    throw new AppError('Invalid contract ID format.', 400);
  }

  // 3. Find contract scoped strictly to authenticated user's ID
  const contract = await ContractModel.findOne({
    _id: new Types.ObjectId(contractId),
    userId: new Types.ObjectId(userId),
  })
    .select('_id fileName status flaggedRisks createdAt updatedAt')
    .lean();

  // 4. Handle contract not found
  if (!contract) {
    throw new AppError('Contract not found.', 404);
  }

  // 5. Send success response
  res.status(200).json({
    success: true,
    contract,
  });
});

/**
 * Controller: Deletes a specific contract and its associated data belonging to the authenticated user.
 *
 * Pipeline:
 * 1. Validates authenticated user ID from req.userId (401 if missing or invalid).
 * 2. Validates contractId parameter from req.params.contractId (400 if invalid).
 * 3. Finds contract matching BOTH _id and userId (preventing unauthorized cross-user deletion).
 * 4. Deletes all associated chunks from ContractChunkModel.
 * 5. Deletes the PDF asset from Cloudinary using deleteContractPDF if cloudinaryPublicId exists.
 * 6. Deletes the contract document from MongoDB only after handling associated data.
 * 7. Returns 200 with { success: true, message: 'Contract deleted successfully.' }.
 */
export const deleteContract = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // 1. Validate authenticated user ID
  const userId = req.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new AppError('Unauthorized: A valid authenticated user ID is required.', 401);
  }

  // 2. Validate contract ID from request params
  const { contractId } = req.params;
  if (!contractId || typeof contractId !== 'string' || !Types.ObjectId.isValid(contractId)) {
    throw new AppError('Invalid contract ID format.', 400);
  }

  // 3. Find contract scoped strictly to authenticated user's ID
  const contract = await ContractModel.findOne({
    _id: new Types.ObjectId(contractId),
    userId: new Types.ObjectId(userId),
  });

  // 4. Handle contract not found
  if (!contract) {
    throw new AppError('Contract not found.', 404);
  }

  // 5. Delete all associated chunks from MongoDB
  await ContractChunkModel.deleteMany({ contractId: contract._id });

  // 6. Delete PDF from Cloudinary if stored publicId is available
  if (contract.cloudinaryPublicId) {
    await deleteContractPDF(contract.cloudinaryPublicId);
  }

  // 7. Delete contract document from MongoDB only after handling its associated data
  await ContractModel.deleteOne({ _id: contract._id, userId: new Types.ObjectId(userId) });

  // 8. Send success response
  res.status(200).json({
    success: true,
    message: 'Contract deleted successfully.',
  });
});

/**
 * Controller: Generates a secure, expiring signed download URL for an authenticated user's contract PDF.
 *
 * Pipeline:
 * 1. Validates authenticated user ID from req.userId (401 if missing or invalid).
 * 2. Validates contractId parameter from req.params.contractId (400 if invalid).
 * 3. Finds contract matching BOTH _id and userId (preventing unauthorized cross-user downloads).
 * 4. Verifies contract exists (404 if not found).
 * 5. Verifies stored Cloudinary public ID exists on the contract record (404 if missing).
 * 6. Generates a signed, expiring private download URL via storage.service.
 * 7. Returns 200 with { success: true, downloadUrl }.
 */
export const downloadContract = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // 1. Validate authenticated user ID
  const userId = req.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw new AppError('Unauthorized: A valid authenticated user ID is required.', 401);
  }

  // 2. Validate contract ID from request params
  const { contractId } = req.params;
  if (!contractId || typeof contractId !== 'string' || !Types.ObjectId.isValid(contractId)) {
    throw new AppError('Invalid contract ID format.', 400);
  }

  // 3. Find contract scoped strictly to authenticated user's ID
  const contract = await ContractModel.findOne({
    _id: new Types.ObjectId(contractId),
    userId: new Types.ObjectId(userId),
  });

  // 4. Handle contract not found
  if (!contract) {
    throw new AppError('Contract not found.', 404);
  }

  // 5. Verify the Cloudinary storage identifier is available
  if (!contract.cloudinaryPublicId) {
    throw new AppError('Contract file is not available for download.', 404);
  }

  // 6. Generate a short-lived signed download URL (default: 3600 seconds / 1 hour)
  const downloadUrl = getSignedContractPDFUrl(contract.cloudinaryPublicId);

  // 7. Send success response with signed download URL
  res.status(200).json({
    success: true,
    downloadUrl,
  });
});