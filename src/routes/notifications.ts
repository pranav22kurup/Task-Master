import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth';
import type { AppDatabase } from '../db/database';
import {
  listNotifications,
  markNotificationRead,
  openNotificationStream,
  toNotificationDTO,
  unreadNotificationCount,
} from '../notifications';

function parsePositiveId(value: string | string[]) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createNotificationsRouter(database: AppDatabase) {
  const router = Router();

  router.use(requireAuth);

  router.get('/', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;
    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const limit = Number.isInteger(Number(request.query.limit)) ? Math.min(Math.max(Number(request.query.limit), 1), 100) : 50;
    const notifications = listNotifications(database, currentUser.id, limit);

    response.json({
      notifications: notifications.map(toNotificationDTO),
      unreadCount: unreadNotificationCount(database, currentUser.id),
    });
  });

  router.get('/stream', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;
    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    openNotificationStream(currentUser.id, response);
  });

  router.post('/:id/read', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;
    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const notificationId = parsePositiveId(request.params.id);
    if (!notificationId) {
      response.status(400).json({ error: 'Invalid notification id.' });
      return;
    }

    const result = markNotificationRead(database, notificationId, currentUser.id);
    if (result.changes === 0) {
      response.status(404).json({ error: 'Notification not found.' });
      return;
    }

    response.json({ ok: true, unreadCount: unreadNotificationCount(database, currentUser.id) });
  });

  return router;
}