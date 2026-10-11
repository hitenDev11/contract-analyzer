import { Request, Response, NextFunction } from 'express';


export class AppError extends Error {
 
  public statusCode?: number;

  constructor(message: string, statusCode?: number) {
    
    super(message);
    
   
    this.statusCode = statusCode;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction    
): void => {
 
  const statusCode = err instanceof AppError && err.statusCode ? err.statusCode : 500;

  console.error(`[Error - Status ${statusCode}]: ${err.message}`);
  if (err.stack) {
    console.error(err.stack);
  }

  const isServerError = statusCode >= 500;
  const safeMessage = isServerError ? 'Internal Server Error' : err.message;

  res.status(statusCode).json({ error: safeMessage });
};
