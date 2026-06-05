import express from 'express';
import { initializeDatabase } from './db/database';

export function createApp() {
  const database = initializeDatabase();
  const app = express();

  app.use(express.json());

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