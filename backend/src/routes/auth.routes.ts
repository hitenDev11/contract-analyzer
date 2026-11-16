import { Router } from 'express';

import {
  register,
  login,
  refreshAccessToken,
  logout,
} from '../controllers/auth.controller';

import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshAccessToken);

// Protect logout with access-token authentication
router.post('/logout', requireAuth, logout);

export default router;