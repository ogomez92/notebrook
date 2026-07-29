import express, { Router } from 'express';
import * as FeedController from '../controllers/feed-controller';

export const router = Router();

// Any Content-Type is read as plain text, so a caller doesn't have to set a
// header to post one line. 64kb is far more than a feed item needs.
const rawText = express.text({ type: () => true, limit: '64kb' });

router.post('/', rawText, FeedController.sendToFeed);
router.get('/', FeedController.sendToFeed);
