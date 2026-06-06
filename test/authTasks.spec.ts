import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, it, expect, beforeAll } from 'vitest';

// Ensure a clean DB for tests
const dataDir = path.resolve(process.cwd(), 'data');
const dbFile = path.join(dataDir, 'task-master.db');

beforeAll(() => {
  try {
    if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
  } catch (e) {
    // ignore
  }
});

describe('Auth and Tasks flow', () => {
  it('registers, logs in, and creates a task', async () => {
    // import createApp after DB cleanup so it initializes fresh
    const { createApp } = await import('../src/app');
    const app = createApp();

    const email = `test+${Date.now()}@example.com`;

    const registerRes = await request(app).post('/auth/register').send({
      name: 'Test User',
      email,
      password: 'password123',
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body).toHaveProperty('token');

    const loginRes = await request(app).post('/auth/login').send({
      email,
      password: 'password123',
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty('token');

    const token = loginRes.body.token as string;

    const taskRes = await request(app)
      .post('/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'E2E Task', description: 'Created in test' });

    expect(taskRes.status).toBe(201);
    expect(taskRes.body).toHaveProperty('task');
    expect(taskRes.body.task.title).toBe('E2E Task');
  }, { timeout: 20000 });
});
