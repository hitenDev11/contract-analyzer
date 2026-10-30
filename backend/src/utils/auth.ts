import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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


export const generateToken = (
  userId: string,
  expiresIn: string = '7d'
): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError(
      'Server configuration error: JWT_SECRET environment variable is missing.',
      500
    );
  }

  return jwt.sign({ userId }, secret, {
    expiresIn,
  } as jwt.SignOptions);
};
