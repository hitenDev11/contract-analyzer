import { Router } from 'express';
import {
  getMyProfile,
  updateMyProfile,
  changePassword,
  deleteMyAccount,
} from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// All user-management routes require a valid access token
router.use(requireAuth);

router.get('/me', getMyProfile);
router.patch('/me', updateMyProfile);
router.patch('/me/password', changePassword);
router.delete('/me', deleteMyAccount);

export default router;
