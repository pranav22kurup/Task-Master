import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AppDatabase } from './db/database';

export interface AuthUserClaims {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface AuthTokenClaims extends AuthUserClaims {
  jti: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserClaims;
  accessToken?: string;
  tokenId?: string;
}

const jwtSecret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';
const jwtExpiresIn = (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'];

let authDatabase: AppDatabase | null = null;

export function setAuthDatabase(database: AppDatabase) {
  authDatabase = database;
}

function isTokenRevoked(tokenId: string) {
  if (!authDatabase) {
    return false;
  }

  const row = authDatabase
    .prepare('SELECT jti FROM revoked_tokens WHERE jti = ?')
    .get(tokenId) as { jti: string } | undefined;

  return Boolean(row);
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAccessToken(user: AuthUserClaims) {
  return jwt.sign({ ...user, jti: randomUUID() }, jwtSecret, { expiresIn: jwtExpiresIn });
}

export function revokeAccessToken(tokenId: string, userId: number) {
  if (!authDatabase) {
    return false;
  }

  authDatabase
    .prepare('INSERT OR IGNORE INTO revoked_tokens (jti, userId) VALUES (?, ?)')
    .run(tokenId, userId);

  return true;
}

function getAuthorizationToken(request: Request) {
  const authorizationHeader = request.headers.authorization;
  const queryToken = typeof request.query.token === 'string' ? request.query.token.trim() : '';

  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice('Bearer '.length).trim();
  }

  if (queryToken) {
    return queryToken;
  }

  return null;
}

export function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const token = getAuthorizationToken(request);

  if (!token) {
    response.status(401).json({ error: 'Missing or invalid authorization token.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as AuthTokenClaims;

    if (decoded.jti && isTokenRevoked(decoded.jti)) {
      response.status(401).json({ error: 'Token has been revoked.' });
      return;
    }

    request.user = {
      id: decoded.id,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
    };
    request.accessToken = token;
    request.tokenId = decoded.jti;
    next();
  } catch {
    response.status(401).json({ error: 'Invalid or expired authorization token.' });
  }
}