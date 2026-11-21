
import { Request, Response } from 'express';
import { Types } from 'mongoose';

import ContractModel from '../models/contract.model';
import ChatMessageModel from '../models/chat-message.model';
import ContractChunkModel from '../models/contract-chunks.model';

import { answerContractQuestion } from '../services/rag.service';
import { AppError } from '../middleware/errorHandler.middleware';
import { asyncHandler } from '../utils/asyncHandler';


export const askQuestion = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId;
    const { contractId } = req.params;
    const { question } = req.body ?? {};

    // Step 1: Verify authentication
    if (!userId) {
      throw new AppError('Unauthorized.', 401);
    }

    // Step 2: Validate contract ID
    if (
      typeof contractId !== 'string' ||
      !Types.ObjectId.isValid(contractId)
    ) {
      throw new AppError('Invalid contract ID.', 400);
    }

    // Step 3: Validate question
    if (
      typeof question !== 'string' ||
      question.trim().length === 0
    ) {
      throw new AppError('Question is required.', 400);
    }

    const trimmedQuestion = question.trim();

    if (trimmedQuestion.length > 2000) {
      throw new AppError(
        'Question cannot exceed 2000 characters.',
        400
      );
    }

    // Step 4: Verify contract ownership
    const contract = await ContractModel.findOne({
      _id: contractId,
      userId,
    });

    if (!contract) {
      throw new AppError('Contract not found.', 404);
    }

    // Step 5: Ensure contract is ready for questions
    if (contract.status !== 'ready') {
      throw new AppError(
        'Contract is not ready for questions.',
        409
      );
    }

    // Fetch the last 6 messages for this user and contract
    const previousMessages = await ChatMessageModel.find({
      contractId: contract._id,
      userId,
    })
      .select('role content')
      .sort({ createdAt: -1, _id: -1 })
      .limit(6)
      .lean();

    // Restore chronological order
    previousMessages.reverse();

    // Generate answer with conversation context
    const result = await answerContractQuestion(
      contractId,
      trimmedQuestion,
      undefined,
      previousMessages.map((message) => ({
        role: message.role,
        content: message.content,
      }))
    );

    const citedChunkIds = [
      ...new Set(
        result.retrievedChunks
          .filter((chunk) =>
            result.citations.includes(chunk.chunkIndex)
          )
          .map((chunk) => chunk.chunkId)
      ),
    ].map((id) => new Types.ObjectId(id));


    // Step 7: Save user question and assistant answer

    await ChatMessageModel.insertMany([
      {
        contractId: contract._id,
        userId,
        role: 'user',
        content: trimmedQuestion,
        sourceChunkIds: [],
      },
      {
        contractId: contract._id,
        userId,
        role: 'assistant',
        content: result.answer,
        sourceChunkIds: citedChunkIds,
      },
    ]);


    // Step 8: Return response
    res.status(200).json({
      success: true,
      message: 'Question answered successfully.',
      data: result,
    });
  }
);

export const getChatHistory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    // Step 1: Get authenticated user and contract ID
    const userId = req.userId;
    const { contractId } = req.params;

    if (!userId) {
      throw new AppError('Unauthorized.', 401);
    }

    // Step 2: Validate contract ID
    if (
      typeof contractId !== 'string' ||
      !Types.ObjectId.isValid(contractId)
    ) {
      throw new AppError('Invalid contract ID.', 400);
    }

    // Step 3: Verify contract ownership
    const contract = await ContractModel.findOne({
      _id: contractId,
      userId,
    }).select('_id');

    if (!contract) {
      throw new AppError('Contract not found.', 404);
    }

    // Step 4: Read pagination parameters
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);

    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      throw new AppError(
        'Invalid pagination parameters. Page must be at least 1 and limit must be between 1 and 100.',
        400
      );
    }

    // Step 5: Count messages
    const totalMessages = await ChatMessageModel.countDocuments({
      contractId: contract._id,
      userId,
    });

    const totalPages = Math.ceil(totalMessages / limit);

    // Step 6: Fetch the latest messages
    const messages = await ChatMessageModel.find({
      contractId: contract._id,
      userId,
    })
      .select('role content sourceChunkIds createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Step 7: Reverse for chronological display
    messages.reverse();

    // Step 8: Return response
    res.status(200).json({
      success: true,
      message: 'Chat history retrieved successfully.',
      data: {
        contractId,
        messages,
        pagination: {
          page,
          limit,
          totalMessages,
          totalPages,
          hasMore: page < totalPages,
        },
      },
    });
  }
);

export const deleteChatHistory = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    // Step 1: Get authenticated user and contract ID
    const userId = req.userId;
    const { contractId } = req.params;

    if (!userId) {
      throw new AppError('Unauthorized.', 401);
    }

    // Step 2: Validate contract ID
    if (
      typeof contractId !== 'string' ||
      !Types.ObjectId.isValid(contractId)
    ) {
      throw new AppError('Invalid contract ID.', 400);
    }

    // Step 3: Verify contract ownership
    const contract = await ContractModel.findOne({
      _id: contractId,
      userId,
    }).select('_id');

    if (!contract) {
      throw new AppError('Contract not found.', 404);
    }

    // Step 4: Delete all chat messages for this contract
    const result = await ChatMessageModel.deleteMany({
      contractId: contract._id,
      userId,
    });

    // Step 5: Return response
    res.status(200).json({
      success: true,
      message: 'Chat history deleted successfully.',
      data: {
        contractId,
        deletedCount: result.deletedCount,
      },
    });
  }
);

export const getCitationSource = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    // Step 1: Get user ID and route parameters
    const userId = req.userId;
    const { contractId, chunkId } = req.params;

    if (!userId) {
      throw new AppError('Unauthorized.', 401);
    }

    // Step 2: Validate contract ID and chunk ID
    if (
      typeof contractId !== 'string' ||
      !Types.ObjectId.isValid(contractId)
    ) {
      throw new AppError('Invalid contract ID.', 400);
    }

    if (
      typeof chunkId !== 'string' ||
      !Types.ObjectId.isValid(chunkId)
    ) {
      throw new AppError('Invalid chunk ID.', 400);
    }

    // Step 3: Verify contract ownership
    const contract = await ContractModel.findOne({
      _id: contractId,
      userId,
    }).select('_id');

    if (!contract) {
      throw new AppError('Contract not found.', 404);
    }

    // Step 4: Find the requested chunk
    const chunk = await ContractChunkModel.findOne({
      _id: chunkId,
      contractId: contract._id,
    })
      .select('_id contractId chunkIndex chunkText')
      .lean();

    if (!chunk) {
      throw new AppError('Citation source not found.', 404);
    }

    // Step 5: Return the supporting contract text
    res.status(200).json({
      success: true,
      message: 'Citation source retrieved successfully.',
      data: {
        chunkId: chunk._id,
        contractId: chunk.contractId,
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
      },
    });
  }
);
