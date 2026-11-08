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
  
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return; 
  }

  const token = authHeader.split(' ')[1];

  try {
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
    
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
