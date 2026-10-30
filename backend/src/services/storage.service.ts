import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';
import { AppError } from '../middleware/errorHandler.middleware';

/**
 * Storage result returned after successfully uploading a contract to Cloudinary.
 */
export interface CloudinaryUploadResult {
  publicId: string;
  secureUrl: string;
}

/**
 * Validates that all required Cloudinary environment variables are present.
 * Never prints or leaks secret values in error messages or logs.
 */
export const isCloudinaryConfigured = (): boolean => {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
};

/**
 * Ensures Cloudinary SDK is initialized with credentials from environment variables.
 * Throws an AppError with status 500 if credentials are not configured.
 */
const configureCloudinary = (): void => {
  if (!isCloudinaryConfigured()) {
    throw new AppError(
      'Cloud storage is not configured. Missing required environment variables (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).',
      500
    );
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
};

/**
 * Uploads a contract PDF buffer directly to Cloudinary using upload_stream.
 * 
 * Security & Privacy:
 * - resource_type: 'raw' (treats PDFs as binary documents).
 * - type: 'authenticated' (stores the document in Cloudinary's protected repository).
 *   The file is NOT accessible through public HTTP links. Unauthorized requests will be rejected.
 * 
 * @param buffer The in-memory PDF Buffer from Multer memoryStorage
 * @param originalFilename The original name of the uploaded contract file
 * @returns Object containing publicId and the canonical secureUrl
 */
export const uploadContractPDF = async (
  buffer: Buffer,
  originalFilename: string
): Promise<CloudinaryUploadResult> => {
  configureCloudinary();

  const folder = process.env.CLOUDINARY_FOLDER || 'contracts';
  const timestamp = Date.now();
  const sanitizedBaseName = originalFilename
    .replace(/\.[^/.]+$/, '') // remove existing extension
    .replace(/[^a-zA-Z0-9_-]/g, '_'); // sanitize special characters

  // For raw assets, Cloudinary preserves public_id verbatim
  const publicId = `${folder}/${timestamp}-${sanitizedBaseName}.pdf`;

  return new Promise<CloudinaryUploadResult>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        type: 'authenticated', // Confidential: protected delivery only
        public_id: publicId,
        overwrite: false,
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) {
          return reject(
            new AppError(
              `Cloud storage upload failed: ${error?.message || 'No response returned from storage service'}`,
              500
            )
          );
        }

        resolve({
          publicId: result.public_id,
          secureUrl: result.secure_url,
        });
      }
    );

    // Pipe in-memory buffer directly to Cloudinary without writing to local disk
    Readable.from(buffer).pipe(uploadStream);
  });
};

/**
 * Removes an uploaded contract PDF from Cloudinary if downstream processing fails.
 * Designed for safe rollback cleanup: does not throw errors that would swallow the original exception.
 * 
 * @param publicId The storage identifier (public_id) of the asset to delete
 */
export const deleteContractPDF = async (publicId: string): Promise<void> => {
  if (!publicId || !isCloudinaryConfigured()) {
    return;
  }

  try {
    configureCloudinary();
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw',
      type: 'authenticated',
      invalidate: true,
    });
  } catch (error: any) {
    // Log the failure to remove the cloud asset without masking the primary processing error
    console.error(`Failed to delete Cloudinary asset "${publicId}":`, error?.message || error);
  }
};

/**
 * Generates an expiring, signed private download URL for an authenticated user.
 * 
 * How Authorized PDF Access Works:
 * 1. Because the contract was uploaded with type: 'authenticated', the canonical secure_url
 *    cannot be accessed directly by unauthorized parties or web scrapers.
 * 2. When an authorized user requests the PDF (e.g., via a protected GET /contracts/:id/download route),
 *    the backend authenticates the user, verifies ownership/permissions, and calls this function.
 * 3. A cryptographically signed URL with an expiration timestamp (default: 1 hour) is returned.
 * 
 * @param publicId The Cloudinary public_id of the contract
 * @param expiresInSeconds Validity duration of the signed link in seconds (default: 3600 = 1 hour)
 * @returns Signed download URL
 */
export const getSignedContractPDFUrl = (
  publicId: string,
  expiresInSeconds: number = 3600
): string => {
  configureCloudinary();

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return cloudinary.utils.private_download_url(publicId, '', {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: expiresAt,
  });
};

/**
 * Generates a signed direct delivery URL for viewing the PDF inline in a secure viewer.
 * 
 * @param publicId The Cloudinary public_id of the contract
 * @param expiresInSeconds Validity duration in seconds (default: 3600 = 1 hour)
 * @returns Signed delivery URL with signature token
 */
export const getSignedDeliveryUrl = (
  publicId: string,
  expiresInSeconds: number = 3600
): string => {
  configureCloudinary();

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return cloudinary.utils.url(publicId, {
    resource_type: 'raw',
    type: 'authenticated',
    sign_url: true,
    secure: true,
    expires_at: expiresAt,
  });
};
