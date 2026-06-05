import express from 'express';
import { createAuthRouter } from './routes/auth';
import { initializeDatabase } from './db/database';
import { createTaskRouter } from './routes/tasks';

export function createApp() {
  const database = initializeDatabase();
  const app = express();

  app.use(express.json());
  app.use('/auth', createAuthRouter(database));
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

  return app;
}