import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth';
import type { AppDatabase } from '../db/database';
import { generateTaskText, validateAiTaskRequest } from '../ai';

export function createAiRouter(database: AppDatabase) {
  const router = Router();

  router.use(requireAuth);

  router.post('/tasks/generate', async (request: AuthenticatedRequest, response) => {
    const validated = validateAiTaskRequest(request.body);

    if ('error' in validated) {
      response.status(400).json({ error: validated.error });
      return;
    }

    try {
      const result = await generateTaskText(database, validated);

      response.json({
        provider: result.provider,
        text: result.text,
      });
    } catch {
      response.status(502).json({ error: 'Unable to generate AI content at this time.' });
    }
  });

  return router;
}