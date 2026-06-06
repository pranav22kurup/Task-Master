import type { RequestHandler } from 'express';
import { ZodError, type ZodSchema } from 'zod';

export function validateBody<T extends ZodSchema>(schema: T): RequestHandler {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse(req.body);
      req.body = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        // attach a property so the global error handler can format it
        // forward the error
        next(err);
      } else {
        next(err);
      }
    }
  };
}
