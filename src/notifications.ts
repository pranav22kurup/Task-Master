import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { AppDatabase } from './db/database';

export interface NotificationInput {
  type: string;
  title: string;
  message: string;
  entityType: string;
  entityId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface NotificationRow {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  entityType: string;
  entityId: number | null;
  metadata: string | null;
  readAt: string | null;
  createdAt: string;
}

type NotificationEvent = NotificationRow & { payload: Record<string, unknown> | null };

const streamBus = new EventEmitter();
const streamClients = new Map<number, Set<Response>>();

function getClientSet(userId: number) {
  const current = streamClients.get(userId);
  if (current) {
    return current;
  }

  const next = new Set<Response>();
  streamClients.set(userId, next);
  return next;
}

function parseMetadata(metadata: string | null) {
  if (!metadata) {
    return null;
  }

  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function emitToUser(userId: number, event: NotificationEvent) {
  streamBus.emit(`notification:${userId}`, event);

  const clients = streamClients.get(userId);
  if (!clients) {
    return;
  }

  const data = JSON.stringify(event);
  for (const client of clients) {
    client.write(`event: notification\n`);
    client.write(`data: ${data}\n\n`);
  }
}

export function getUserNotificationListeners(userId: number) {
  return getClientSet(userId);
}

export function subscribeToUserNotifications(userId: number, listener: (event: NotificationEvent) => void) {
  const eventName = `notification:${userId}`;
  streamBus.on(eventName, listener);
  return () => streamBus.off(eventName, listener);
}

export function addNotification(database: AppDatabase, userId: number, input: NotificationInput) {
  const result = database
    .prepare(
      `INSERT INTO notifications (userId, type, title, message, entityType, entityId, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      input.type,
      input.title,
      input.message,
      input.entityType,
      input.entityId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null
    );

  const row = database
    .prepare(
      `SELECT id, userId, type, title, message, entityType, entityId, metadata, readAt, createdAt
       FROM notifications
       WHERE id = ?`
    )
    .get(result.lastInsertRowid) as NotificationRow | undefined;

  if (!row) {
    return null;
  }

  const event: NotificationEvent = {
    ...row,
    payload: parseMetadata(row.metadata),
  };

  emitToUser(userId, event);
  return row;
}

export function addNotifications(database: AppDatabase, userIds: Iterable<number>, input: NotificationInput) {
  const uniqueUserIds = new Set<number>();
  for (const userId of userIds) {
    uniqueUserIds.add(userId);
  }

  for (const userId of uniqueUserIds) {
    addNotification(database, userId, input);
  }
}

export function listNotifications(database: AppDatabase, userId: number, limit = 50) {
  return database
    .prepare(
      `SELECT id, userId, type, title, message, entityType, entityId, metadata, readAt, createdAt
       FROM notifications
       WHERE userId = ?
       ORDER BY createdAt DESC, id DESC
       LIMIT ?`
    )
    .all(userId, limit) as NotificationRow[];
}

export function unreadNotificationCount(database: AppDatabase, userId: number) {
  const row = database
    .prepare('SELECT COUNT(*) as count FROM notifications WHERE userId = ? AND readAt IS NULL')
    .get(userId) as { count: number } | undefined;

  return row?.count ?? 0;
}

export function markNotificationRead(database: AppDatabase, notificationId: number, userId: number) {
  return database
    .prepare('UPDATE notifications SET readAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?')
    .run(notificationId, userId);
}

export function openNotificationStream(userId: number, response: Response) {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.flushHeaders();

  response.write('event: connected\n');
  response.write(`data: ${JSON.stringify({ userId })}\n\n`);

  const clients = getUserNotificationListeners(userId);
  clients.add(response);

  const heartbeat = setInterval(() => {
    response.write(': heartbeat\n\n');
  }, 25000);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(response);
    if (clients.size === 0) {
      streamClients.delete(userId);
    }
  };

  response.on('close', cleanup);
  response.on('error', cleanup);

  return cleanup;
}

export function toNotificationDTO(notification: NotificationRow) {
  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    entityType: notification.entityType,
    entityId: notification.entityId,
    metadata: parseMetadata(notification.metadata),
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}