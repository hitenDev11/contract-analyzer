import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.routes';
import contractRoutes from './routes/contract.routes';
import userRoutes from './routes/user.routes';
import { errorHandler } from './middleware/errorHandler.middleware';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'Contract Analyzer API is running',
    timestamp: new Date().toISOString(),
  });
});

// Authentication routes
app.use('/api/auth', authRoutes);

// User management routes
app.use('/api/users', userRoutes);

// Contract routes
app.use('/api/contracts', contractRoutes);

// Global error handling middleware (must be registered after routes)
app.use(errorHandler);

export default app;
