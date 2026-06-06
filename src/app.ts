import express, { type ErrorRequestHandler } from 'express';
import { createAuthRouter } from './routes/auth';
import { initializeDatabase } from './db/database';
import { createNotificationsRouter } from './routes/notifications';
import { createAiRouter } from './routes/ai';
import { createTaskRouter } from './routes/tasks';
import { createTeamRouter } from './routes/teams';
import { createProjectRouter } from './routes/projects';
import { setAuthDatabase } from './auth';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import morgan from 'morgan';

export function createApp() {
  const database = initializeDatabase();
  setAuthDatabase(database);
  const app = express();
  app.use(express.json());

  // Request logging for debugging
  app.use(morgan('dev'));

  // Security middleware
  app.use(helmet());
  // Conservative CORS defaults: allow same origin and localhost development
  app.use(
    cors({
      origin: (origin, cb) => {
        // allow requests with no origin like mobile apps or curl
        if (!origin) return cb(null, true);
        // allow localhost during development
        if (origin.includes('localhost')) return cb(null, true);
        // otherwise deny by default
        cb(new Error('CORS policy: origin not allowed'));
      },
    })
  );

  // Rate limiting: conservative defaults
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(globalLimiter);

  // Route-specific stricter limits
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit auth endpoints to 20 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
  });

  const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // limit AI generation to 5 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/auth', authLimiter, createAuthRouter(database));
  app.use('/notifications', createNotificationsRouter(database));
  app.use('/ai', aiLimiter, createAiRouter(database));
  app.use('/teams', createTeamRouter(database));
  app.use('/projects', createProjectRouter(database));
  app.use('/tasks', createTaskRouter(database));

  app.get('/', (_request, response) => {
    response.json({
      message: 'Task Master API is running',
    });
  });

  app.get('/health', (_request, response) => {
    response.json({
      status: 'ok',
      database: database.open ? 'ready' : 'closed',
    });
  });

  // Central error handler
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    // Zod validation errors
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        details: (err as any).issues.map((issue: any) => ({ path: issue.path, message: issue.message })),
      });
    }

    // CORS error
    if (err && (err as Error).message && (err as Error).message.startsWith('CORS policy')) {
      return res.status(403).json({ error: (err as Error).message });
    }

    // Generic errors
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  };

  app.use(errorHandler);

  return app;
}