import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { createHash } from 'crypto';
import { AppError } from '../middleware/errorHandler.middleware';

const SALT_ROUNDS = 10;

export const hashPassword = async (password: string): Promise<string> => {
  return await bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return await bcrypt.compare(password, hash);
};

// Generate a short-lived access token
export const generateAccessToken = (
  userId: string,
  tokenVersion: number
): string => {
  const secret = process.env.ACCESS_TOKEN_SECRET;

  if (!secret) {
    throw new Error('ACCESS_TOKEN_SECRET is not configured.');
  }

  return jwt.sign(
    { userId, tokenVersion },
    secret,
    { expiresIn: '15m' }
  );
};

// Generate a longer-lived refresh token
export const generateRefreshToken = (userId: string): string => {
  const secret = process.env.REFRESH_TOKEN_SECRET;

  if (!secret) {
    throw new AppError('REFRESH_TOKEN_SECRET is missing.', 500);
  }

   return jwt.sign(
    { userId },
    process.env.REFRESH_TOKEN_SECRET!,
    {
      expiresIn: '7d',
      jwtid: randomUUID(),
    }
  );
};

// Hash the refresh token before storing it in MongoDB
export const hashToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex');
};
