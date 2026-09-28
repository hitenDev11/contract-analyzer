import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';


declare global {
  namespace Express {
    interface Request {
      userId?: string; 
    }
  }
}

// Define an interface for the expected structure of our decoded JWT payload
interface JwtPayload {
  userId: string;
}

/**
 * Authentication middleware that verifies a JWT token from the Authorization header.
 */
export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // 1. Read the Authorization header from the incoming request
  const authHeader = req.headers.authorization;

  // 2. Check if the header exists and matches the required "Bearer <token>" format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return; 
  }

  // 3. Extract the token itself (e.g., from "Bearer abc.def.ghi", extract "abc.def.ghi")
  const token = authHeader.split(' ')[1];

  try {
    // 4. Verify the secret key is configured in the environment
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET environment variable is missing.');
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

   
    const decoded = jwt.verify(token, secret) as JwtPayload;

    req.userId = decoded.userId;

    // 7. Everything is valid. Call next() to pass control to the actual route handler!
    next();
  } catch (error) {
    // 8. If jwt.verify() throws an error, it means the token is invalid, tampered with, or expired.
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
