import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export interface AuthUserClaims {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserClaims;
}

const jwtSecret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';
const jwtExpiresIn = (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'];

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAccessToken(user: AuthUserClaims) {
  return jwt.sign(user, jwtSecret, { expiresIn: jwtExpiresIn });
}

export function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const authorizationHeader = request.headers.authorization;

  if (!authorizationHeader?.startsWith('Bearer ')) {
    response.status(401).json({ error: 'Missing or invalid authorization token.' });
    return;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();

  try {
    const decoded = jwt.verify(token, jwtSecret) as AuthUserClaims;
    request.user = decoded;
    next();
  } catch {
    response.status(401).json({ error: 'Invalid or expired authorization token.' });
  }
}