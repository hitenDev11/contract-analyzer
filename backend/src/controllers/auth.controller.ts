import { Request, Response } from 'express';
import UserModel from '../models/user.model';
import { hashPassword, comparePassword, generateToken } from '../utils/auth';
import { AppError } from '../middleware/errorHandler.middleware';
import { asyncHandler } from '../utils/asyncHandler';


const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


export const register = asyncHandler(async (req: Request, res: Response): Promise<void> => {
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

  const existingUser = await UserModel.findOne({ email: normalizedEmail });
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
      throw new AppError('An account with this email already exists.', 409);
    }
    throw dbError;
  }

  const token = generateToken(user._id.toString());

  res.status(201).json({
    success: true,
    message: 'User registered successfully.',
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    },
  });
});


export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
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

  const user = await UserModel.findOne({ email: normalizedEmail });
  if (!user) {
    throw new AppError('Invalid email or password.', 401);
  }

  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) {
    throw new AppError('Invalid email or password.', 401);
  }

  const token = generateToken(user._id.toString());

  res.status(200).json({
    success: true,
    message: 'Login successful.',
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    },
  });
});
