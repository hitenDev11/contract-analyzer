
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import UserModel from '../models/user.model';
import SessionModel from '../models/Session.model';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
    }
  }
}


export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.slice(7).trim();

  try {
    const secret = process.env.ACCESS_TOKEN_SECRET;

    if (!secret) {
      console.error('ACCESS_TOKEN_SECRET is missing.');
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    // Step 1: Verify access token
    const decoded = jwt.verify(token, secret);

    // Step 2: Validate JWT payload
    if (
      typeof decoded === 'string' ||
      typeof decoded.userId !== 'string' ||
      !Types.ObjectId.isValid(decoded.userId) ||
      !Number.isSafeInteger(decoded.tokenVersion) ||
      decoded.tokenVersion < 0 ||
      typeof decoded.sessionId !== 'string' ||
      !Types.ObjectId.isValid(decoded.sessionId)
    ) {
      res.status(401).json({ error: 'Invalid access token' });
      return;
    }

    // Step 3: Find user
    const user = await UserModel.findById(
      decoded.userId
    ).select('tokenVersion');

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    // Step 4: Verify tokenVersion
    if (decoded.tokenVersion !== user.tokenVersion) {
      res.status(401).json({
        error: 'Session expired. Please log in again.',
      });
      return;
    }

    // Step 5: Check whether the session still exists
    const session = await SessionModel.findOne({
      _id: decoded.sessionId,
      userId: user._id,
      expiresAt: { $gt: new Date() },
    }).select('_id');

    if (!session) {
      res.status(401).json({
        error: 'Session has expired or been revoked. Please log in again.',
      });
      return;
    }

    // Step 6: Attach authenticated user and session IDs
    req.userId = user._id.toString();
    req.sessionId = session._id.toString();

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: 'Invalid or expired token',
      });
      return;
    }

    next(error);
  }
};
