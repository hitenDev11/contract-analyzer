import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import UserModel from '../models/user.model';
import SessionModel from '../models/Session.model';
import ContractModel from '../models/contract.model';
import ContractChunkModel from '../models/contract-chunks.model';
import ChatMessageModel from '../models/chat-message.model';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from '../utils/auth';
import PendingFileDeletionModel from '../models/pending-file-deletion.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { asyncHandler } from '../utils/asyncHandler';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const REFRESH_TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_TTL_MS,
};

const CLEAR_REFRESH_TOKEN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
};

interface RefreshTokenPayload {
  userId: string;
  iat?: number;
  exp?: number;
}


const verifyRefreshToken = (
  token: string
): RefreshTokenPayload | null => {
  const secret = process.env.REFRESH_TOKEN_SECRET;

  if (!secret) return null;

  try {
    const decoded = jwt.verify(token, secret);

    // Make sure decoded is an object
    if (
      typeof decoded !== 'object' ||
      decoded === null
    ) {
      return null;
    }

    // Make sure userId exists and is a string
    if (typeof decoded.userId !== 'string') {
      return null;
    }

    // Make sure userId is a valid MongoDB ObjectId
    if (!Types.ObjectId.isValid(decoded.userId)) {
      return null;
    }

    return {
      userId: decoded.userId,
      iat: decoded.iat,
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
};

export const register = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, password } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required.', 400);
    }

    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      throw new AppError('Email is required.', 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      throw new AppError('Please provide a valid email address.', 400);
    }

    if (!password || typeof password !== 'string') {
      throw new AppError('Password is required.', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters long.', 400);
    }

    if (password.length > 128) {
      throw new AppError('Password cannot exceed 128 characters.', 400);
    }

    const existingUser = await UserModel.findOne({
      email: normalizedEmail,
    });

    if (existingUser) {
      throw new AppError('An account with this email already exists.', 409);
    }

    const hashedPassword = await hashPassword(password);

    let user;

    try {
      user = await UserModel.create({
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword,
      });
    } catch (dbError: any) {
      if (dbError?.code === 11000) {
        throw new AppError(
          'An account with this email already exists.',
          409
        );
      }

      throw dbError;
    }

    const userId = user._id.toString();

    const accessToken = generateAccessToken(
      user._id.toString(),
      user.tokenVersion
    );
    const refreshToken = generateRefreshToken(userId);

    const refreshTokenHash = hashToken(refreshToken);

    await SessionModel.create({
      userId: user._id,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.cookie(
      'refreshToken',
      refreshToken,
      REFRESH_TOKEN_COOKIE_OPTIONS
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      accessToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  }
);

export const login = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (
      !email ||
      !password ||
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      email.trim().length === 0
    ) {
      throw new AppError('Email and password are required.', 400);
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await UserModel.findOne({
      email: normalizedEmail,
    });

    if (!user) {
      throw new AppError('Invalid email or password.', 401);
    }

    const isMatch = await comparePassword(password, user.password);

    if (!isMatch) {
      throw new AppError('Invalid email or password.', 401);
    }

    const userId = user._id.toString();

    const accessToken = generateAccessToken(
      user._id.toString(),
      user.tokenVersion
    );
    const refreshToken = generateRefreshToken(userId);

    const refreshTokenHash = hashToken(refreshToken);

    await SessionModel.create({
      userId: user._id,
      refreshTokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.cookie(
      'refreshToken',
      refreshToken,
      REFRESH_TOKEN_COOKIE_OPTIONS
    );

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      accessToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  }
);

export const refreshAccessToken = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const incomingToken: string | undefined = req.cookies?.refreshToken;

    if (!incomingToken) {
      throw new AppError('Refresh token is missing.', 401);
    }

    // Step 1: Verify refresh token
    const payload = verifyRefreshToken(incomingToken);

    if (!payload || !payload.userId) {
      throw new AppError('Invalid or expired refresh token.', 401);
    }

    const incomingHash = hashToken(incomingToken);

    let newAccessToken: string | undefined;
    let newRefreshToken: string | undefined;

    // Step 2: Start MongoDB transaction
    await mongoose.connection.transaction(async (dbSession) => {
      // Step 3: Find and delete old session
      const session = await SessionModel.findOneAndDelete(
        { refreshTokenHash: incomingHash },
        {
          session: dbSession,
          projection: {
            refreshTokenHash: 1,
            userId: 1,
            expiresAt: 1,
          },
        }
      );

      if (!session) {
        throw new AppError(
          'Refresh token has already been used or revoked.',
          401
        );
      }

      // Step 4: Verify session expiry
      if (session.expiresAt <= new Date()) {
        throw new AppError(
          'Session has expired. Please log in again.',
          401
        );
      }

      // Step 5: Verify user exists
      const user = await UserModel.findById(
        session.userId
      ).session(dbSession);

      if (!user) {
        throw new AppError(
          'User account no longer exists.',
          401
        );
      }

      // Step 6: Verify token belongs to this user
      if (session.userId.toString() !== payload.userId) {
        throw new AppError('Token payload mismatch.', 401);
      }

      // Step 7: Generate replacement tokens
      const userId = user._id.toString();

      const accessToken = generateAccessToken(
        user._id.toString(),
        user.tokenVersion
      );
      const refreshToken = generateRefreshToken(userId);

      // Step 8: Create replacement session
      await SessionModel.create(
        [
          {
            userId: user._id,
            refreshTokenHash: hashToken(refreshToken),
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
          },
        ],
        { session: dbSession }
      );

      newAccessToken = accessToken;
      newRefreshToken = refreshToken;
    });

    // Step 9: Only send tokens after transaction commits
    if (!newAccessToken || !newRefreshToken) {
      throw new AppError('Unable to rotate refresh token.', 500);
    }

    res.cookie(
      'refreshToken',
      newRefreshToken,
      REFRESH_TOKEN_COOKIE_OPTIONS
    );

    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
    });
  }
);

export const logout = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const incomingToken: string | undefined = req.cookies?.refreshToken;

    if (incomingToken) {
      const payload = verifyRefreshToken(incomingToken);
      if (payload) {
        // Revoke the specific session matching this token hash only
        const tokenHash = hashToken(incomingToken);
        await SessionModel.deleteOne({ refreshTokenHash: tokenHash });
      }
      // If JWT is invalid, the session (if any) expired naturally via MongoDB TTL.
      // Either way, clear the cookie.
    }

    res.clearCookie('refreshToken', CLEAR_REFRESH_TOKEN_COOKIE_OPTIONS);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  }
);

export const getMyProfile = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId;

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new AppError('Authentication required.', 401);
    }

    const user = await UserModel.findById(userId).select(
      '_id name email createdAt updatedAt'
    );

    if (!user) {
      throw new AppError('User not found.', 404);
    }

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }
);

export const updateMyProfile = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId;

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new AppError('Authentication required.', 401);
    }

    // Whitelist: only these two fields are ever applied
    const { name, email } = req.body;

    const updates: { name?: string; email?: string } = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new AppError('Name must be a non-empty string.', 400);
      }
      updates.name = name.trim();
    }

    if (email !== undefined) {
      if (typeof email !== 'string' || email.trim().length === 0) {
        throw new AppError('Email must be a non-empty string.', 400);
      }
      const normalizedEmail = email.trim().toLowerCase();
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        throw new AppError('Please provide a valid email address.', 400);
      }

      // Check for duplicate email (excluding own account)
      const conflict = await UserModel.findOne({
        email: normalizedEmail,
        _id: { $ne: userId },
      });
      if (conflict) {
        throw new AppError('This email address is already in use.', 409);
      }

      updates.email = normalizedEmail;
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError('No valid fields provided for update.', 400);
    }

    let updatedUser;

    try {
      updatedUser = await UserModel.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true, runValidators: true }
      ).select('_id name email createdAt updatedAt');
    } catch (error: unknown) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new AppError(
          'This email address is already in use.',
          409
        );
      }

      throw error;
    }

    if (!updatedUser) {
  throw new AppError('User not found.', 404);
}

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
    });
  }
);

export const changePassword = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId;

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new AppError('Authentication required.', 401);
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      throw new AppError('Current password is required.', 400);
    }

    if (!newPassword || typeof newPassword !== 'string') {
      throw new AppError('New password is required.', 400);
    }

    if (newPassword.length < 8) {
      throw new AppError('New password must be at least 8 characters long.', 400);
    }

    if (newPassword.length > 128) {
      throw new AppError('New password cannot exceed 128 characters.', 400);
    }

    // Fetch the user including password field (not selected by default)
    const user = await UserModel.findById(userId).select('+password');
    if (!user) {
      throw new AppError('User not found.', 404);
    }

    const isMatch = await comparePassword(currentPassword, user.password);
    if (!isMatch) {
      throw new AppError('Current password is incorrect.', 401);
    }

    const hashedNew = await hashPassword(newPassword);
    user.password = hashedNew;
    await user.save();

    // Revoke ALL sessions for this user across all devices
    await SessionModel.deleteMany({ userId: user._id });

    // Clear the current refresh-token cookie
    res.clearCookie('refreshToken', CLEAR_REFRESH_TOKEN_COOKIE_OPTIONS);

    res.status(200).json({
      success: true,
      message: 'Password changed successfully. Please log in again.',
    });
  }
);

export const deleteMyAccount = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.userId;

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new AppError('Authentication required.', 401);
    }

    const { currentPassword } = req.body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      throw new AppError(
        'Current password confirmation is required.',
        400
      );
    }

    // Step 1: Verify the user's identity
    const user = await UserModel.findById(userId).select('+password');

    if (!user) {
      throw new AppError('User not found.', 404);
    }

    const isMatch = await comparePassword(
      currentPassword,
      user.password
    );

    if (!isMatch) {
      throw new AppError(
        'Password confirmation is incorrect.',
        401
      );
    }

    const userObjectId = user._id as Types.ObjectId;

    // Step 2: Start a MongoDB transaction
    await mongoose.connection.transaction(async (session) => {

      // Find contracts belonging to this user
      const contracts = await ContractModel.find(
        { userId: userObjectId },
        { _id: 1, cloudinaryPublicId: 1 }
      ).session(session);

      const contractIds = contracts.map(
        (contract) => contract._id
      );

      // Step 3: Collect Cloudinary public IDs
      const publicIds = [
        ...new Set(
          contracts
            .map((contract) => contract.cloudinaryPublicId)
            .filter((id): id is string => Boolean(id))
        ),
      ];

      // Step 4: Save pending file-deletion jobs
      if (publicIds.length > 0) {
        await PendingFileDeletionModel.bulkWrite(
          publicIds.map((publicId) => ({
            updateOne: {
              filter: { publicId },
              update: {
                $setOnInsert: {
                  publicId,
                  attempts: 0,
                  nextRetryAt: new Date(),
                },
              },
              upsert: true,
            },
          })),
          { session }
        );
      }

      // Step 5: Delete chat messages
      if (contractIds.length > 0) {
        await ChatMessageModel.deleteMany(
          { contractId: { $in: contractIds } },
          { session }
        );
      }

      // Step 6: Delete contract chunks
      if (contractIds.length > 0) {
        await ContractChunkModel.deleteMany(
          { contractId: { $in: contractIds } },
          { session }
        );
      }

      // Step 7: Delete contract documents
      await ContractModel.deleteMany(
        { userId: userObjectId },
        { session }
      );

      // Step 8: Revoke all refresh-token sessions
      await SessionModel.deleteMany(
        { userId: userObjectId },
        { session }
      );

      // Step 9: Delete the user account
      await UserModel.findByIdAndDelete(
        userObjectId,
        { session }
      );
    });

    // Transaction successfully committed

    // Step 10: Clear the refresh-token cookie
    res.clearCookie(
      'refreshToken',
      CLEAR_REFRESH_TOKEN_COOKIE_OPTIONS
    );

    res.status(200).json({
      success: true,
      message:
        'Account deleted successfully. Cloudinary file cleanup has been scheduled.',
    });
  }
);