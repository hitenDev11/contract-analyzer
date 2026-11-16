import { Router } from 'express';
import {
  getMyProfile,
  updateMyProfile,
  changePassword,
  deleteMyAccount,
} from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.use(requireAuth);

router.get('/get', getMyProfile);
router.patch('/update', updateMyProfile);
router.patch('/change/password', changePassword);
router.delete('/delete', deleteMyAccount);

export default router;
