import { Router } from 'express';
import type { AppDatabase } from '../db/database';
import {
  hashPassword,
  requireAuth,
  signAccessToken,
  verifyPassword,
  type AuthenticatedRequest,
} from '../auth';

interface UserRow {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

function mapToPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createAuthRouter(database: AppDatabase) {
  const router = Router();

  router.post('/register', async (request, response) => {
    const { name, email, password } = request.body as {
      name?: unknown;
      email?: unknown;
      password?: unknown;
    };

    if (!isNonEmptyString(name) || !isNonEmptyString(email) || !isNonEmptyString(password)) {
      response.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }

    if (password.trim().length < 8) {
      response.status(400).json({ error: 'Password must be at least 8 characters long.' });
      return;
    }

    const normalizedEmail = normalizeEmail(email);
    const existingUser = database
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(normalizedEmail) as { id: number } | undefined;

    if (existingUser) {
      response.status(409).json({ error: 'A user with that email already exists.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const insertedUser = database
      .prepare(
        `INSERT INTO users (name, email, passwordHash)
         VALUES (?, ?, ?)`
      )
      .run(name.trim(), normalizedEmail, passwordHash);

    const user = database
      .prepare('SELECT id, name, email, passwordHash, role, createdAt, updatedAt FROM users WHERE id = ?')
      .get(insertedUser.lastInsertRowid) as UserRow | undefined;

    if (!user) {
      response.status(500).json({ error: 'Failed to create user.' });
      return;
    }

    const publicUser = mapToPublicUser(user);

    response.status(201).json({
      token: signAccessToken({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      }),
      user: publicUser,
    });
  });

  router.post('/login', async (request, response) => {
    const { email, password } = request.body as {
      email?: unknown;
      password?: unknown;
    };

    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      response.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const user = database
      .prepare('SELECT id, name, email, passwordHash, role, createdAt, updatedAt FROM users WHERE email = ?')
      .get(normalizeEmail(email)) as UserRow | undefined;

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      response.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    response.json({
      token: signAccessToken({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      }),
      user: mapToPublicUser(user),
    });
  });

  router.get('/me', requireAuth, (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const user = database
      .prepare('SELECT id, name, email, passwordHash, role, createdAt, updatedAt FROM users WHERE id = ?')
      .get(currentUser.id) as UserRow | undefined;

    if (!user) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }

    response.json({ user: mapToPublicUser(user) });
  });

  router.patch('/me', requireAuth, async (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const { name, email, password } = request.body as {
      name?: unknown;
      email?: unknown;
      password?: unknown;
    };

    const updates: string[] = [];
    const parameters: Array<string | number> = [];

    if (isNonEmptyString(name)) {
      updates.push('name = ?');
      parameters.push(name.trim());
    }

    if (isNonEmptyString(email)) {
      const normalizedEmail = normalizeEmail(email);
      const existingUser = database
        .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(normalizedEmail, currentUser.id) as { id: number } | undefined;

      if (existingUser) {
        response.status(409).json({ error: 'A user with that email already exists.' });
        return;
      }

      updates.push('email = ?');
      parameters.push(normalizedEmail);
    }

    if (isNonEmptyString(password)) {
      if (password.trim().length < 8) {
        response.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      updates.push('passwordHash = ?');
      parameters.push(await hashPassword(password));
    }

    if (updates.length === 0) {
      response.status(400).json({ error: 'Provide at least one field to update.' });
      return;
    }

    updates.push('updatedAt = CURRENT_TIMESTAMP');
    parameters.push(currentUser.id);

    database
      .prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      .run(...parameters);

    const updatedUser = database
      .prepare('SELECT id, name, email, passwordHash, role, createdAt, updatedAt FROM users WHERE id = ?')
      .get(currentUser.id) as UserRow | undefined;

    if (!updatedUser) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }

    response.json({ user: mapToPublicUser(updatedUser) });
  });

  return router;
}