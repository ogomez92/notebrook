import { Router } from 'express';
import * as PushController from '../controllers/push-controller';
import { authenticate } from '../middleware/auth';

export const router = Router({ mergeParams: true });

router.get('/config', authenticate, PushController.getConfig);
router.get('/devices', authenticate, PushController.listDevices);
router.post('/devices', authenticate, PushController.registerDevice);
router.delete('/devices/:deviceId', authenticate, PushController.deleteDevice);
router.post('/devices/:deviceId/test', authenticate, PushController.testDevice);
