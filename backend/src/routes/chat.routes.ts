import { Router } from 'express';
import {
  askQuestion,
  getChatHistory,
  deleteChatHistory,
  getCitationSource
} from '../controllers/chat.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.post(
  '/contracts/:contractId/ask',
  requireAuth,
  askQuestion
);

router.get(
  '/contracts/:contractId/chats',
  requireAuth,
  getChatHistory
);

router.delete(
  '/contracts/:contractId/chats',
  requireAuth,
  deleteChatHistory
);

router.get(
  '/contracts/:contractId/chunks/:chunkId',
  requireAuth,
  getCitationSource
);


export default router;
