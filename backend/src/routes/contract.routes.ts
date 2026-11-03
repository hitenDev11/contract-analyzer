import { Router } from 'express';
import {
  uploadContract,
  getUserContracts,
  getContractById,
  deleteContract,
  downloadContract,
} from '../controllers/contract.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { upload } from '../middleware/upload.middleware';

const router = Router();

// Require authentication for all contract routes
router.use(requireAuth);

// Contract management endpoints
router.post('/upload', upload.single('file'), uploadContract);
router.get('/', getUserContracts);
router.get('/:contractId', getContractById);
router.delete('/:contractId', deleteContract);
router.get('/:contractId/download', downloadContract);

export default router;
