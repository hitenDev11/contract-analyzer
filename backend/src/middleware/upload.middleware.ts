import multer from 'multer';
import { AppError } from '../middleware/errorHandler.middleware';

/**
 * Maximum permitted file size for uploaded contracts (10 MB).
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB in bytes


export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, 
  },
  fileFilter: (_req, file, cb) => {
    const isPdfMime = file.mimetype.toLowerCase() === 'application/pdf';
    const hasPdfExtension = file.originalname.toLowerCase().endsWith('.pdf');

    // Both MIME type and filename extension must match PDF format
    if (isPdfMime && hasPdfExtension) {
      cb(null, true);
    } else {
      cb(new AppError('Invalid file format. Only PDF documents (.pdf) are supported.', 400));
    }
  },
});
