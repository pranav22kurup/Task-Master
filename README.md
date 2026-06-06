# Task Master API

Task Master is a TypeScript REST API for task tracking, team collaboration, notifications, and AI-assisted task writing. It uses Express, SQLite, JWT auth, Zod validation, and a configurable OpenAI-backed AI endpoint with a local fallback.

## What This Project Does

The API supports:

- user registration, login, logout, and profile updates
- task creation, filtering, updating, and deletion
- comments and attachments on tasks
- teams and projects with invite/join flows
- notifications, including a live Server-Sent Events stream
- AI-generated task descriptions or summaries

## Tech Stack

- Runtime: Node.js 18+ recommended
- Language: TypeScript
- Web framework: Express 5
- Database: SQLite via `better-sqlite3`
- Auth: JWT with `bcryptjs`
- Validation: Zod
- Security: `helmet`, `cors`, `express-rate-limit`
- Logging: `morgan`
- Testing: Vitest and Supertest

## Project Structure

- `src/server.ts` - application entry point
- `src/app.ts` - Express app setup, middleware, and routing
- `src/db/database.ts` - SQLite schema and initialization
- `src/auth.ts` - password hashing, JWT helpers, and auth middleware
- `src/routes/*` - route handlers for auth, tasks, teams, projects, notifications, and AI
- `src/schemas/*` - request validation schemas
- `scripts/` - smoke-test scripts
- `test/` - automated tests

## Setup

1. Install Node.js 18 or newer.
2. Install dependencies.

```bash
npm install
```

3. Create a `.env` file in the project root.

```env
PORT=3000
JWT_SECRET=replace_with_a_long_random_secret
OPENAI_API_KEY=your_real_openai_key
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

4. Start the development server.

```bash
npm run dev
```

5. Verify the API.

```bash
curl http://localhost:3000/health
```

## Scripts

- `npm run dev` - start the server with watch mode
- `npm run build` - compile TypeScript to `dist/`
- `npm start` - run the compiled server
- `npm test` - run the test suite

## Authentication

Most endpoints require a JWT bearer token in the `Authorization` header.

```http
Authorization: Bearer YOUR_JWT
```

## Core Endpoints

### Auth

- `POST /auth/register` - create an account
- `POST /auth/login` - log in and receive a JWT
- `POST /auth/logout` - revoke the current JWT
- `GET /auth/me` - fetch the current profile
- `PATCH /auth/me` - update the current profile

### Tasks

- `POST /tasks` - create a task
- `GET /tasks` - list tasks with filters, search, and sorting
- `GET /tasks/:id` - fetch one task
- `PATCH /tasks/:id` - update a task
- `DELETE /tasks/:id` - delete a task
- `GET /tasks/:taskId/comments` - list comments
- `POST /tasks/:taskId/comments` - add a comment
- `DELETE /tasks/:taskId/comments/:commentId` - delete a comment you own
- `GET /tasks/:taskId/attachments` - list attachments
- `POST /tasks/:taskId/attachments` - add an attachment
- `DELETE /tasks/:taskId/attachments/:attachmentId` - delete an attachment

### Teams

- `POST /teams` - create a team
- `GET /teams` - list teams you belong to
- `GET /teams/:id` - view a team
- `POST /teams/join` - join a team by code

### Projects

- `POST /projects` - create a project
- `GET /projects` - list projects you belong to
- `GET /projects/:id` - view a project
- `POST /projects/join` - join a project by code

### Notifications

- `GET /notifications` - list notifications
- `GET /notifications/stream` - open a real-time SSE stream
- `POST /notifications/:id/read` - mark one notification as read

### AI

- `POST /ai/tasks/generate` - generate a task description or summary

## Request Examples

### Register

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "password": "StrongPass123"
  }'
```

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "ada@example.com",
    "password": "StrongPass123"
  }'
```

### Create a Task

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Prepare sprint demo",
    "description": "Collect release notes and screenshots",
    "dueDate": "2026-06-10",
    "status": "todo",
    "priority": "high"
  }'
```

### List and Filter Tasks

```bash
curl "http://localhost:3000/tasks?status=todo&search=demo&sortBy=dueDate&sortOrder=asc" \
  -H "Authorization: Bearer YOUR_JWT"
```

### Add a Task Comment

```bash
curl -X POST http://localhost:3000/tasks/1/comments \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "I have started this work and will share an update today."
  }'
```

### Open the Notification Stream

```bash
curl -N "http://localhost:3000/notifications/stream?token=YOUR_JWT"
```

### Generate Task Copy with AI

```bash
curl -X POST http://localhost:3000/ai/tasks/generate \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Launch checklist",
    "context": "Need a concise description for the release task",
    "mode": "description",
    "tone": "clear",
    "audience": "Developers"
  }'
```

## User Stories

These were the main product stories discussed while building the API:

- As a user, I can register, log in, log out, and update my profile.
- As a user, I can create tasks and set their title, description, due date, status, priority, and assignments.
- As a user, I can search, filter, and sort tasks so I can find work quickly.
- As a user, I can attach comments and files to tasks to coordinate with my team.
- As a team member, I can create or join teams and projects so work can be organized by group.
- As a user, I can receive notifications and open a live stream for real-time updates.
- As a user, I can generate task descriptions or summaries with AI instead of writing them manually.
- As a developer, I can validate incoming request data and get consistent API error responses.
- As an operator, I can run the service with conservative security defaults and rate limiting.

## Validation and Security

- Request bodies for key routes are validated with Zod.
- Invalid input returns structured validation errors.
- The app uses `helmet` for security headers.
- CORS is restricted to localhost and same-origin style requests by default.
- Rate limiting is enabled globally and tightened on auth and AI routes.

## AI Provider Behavior

- If `OPENAI_API_KEY` is available, the API attempts to use OpenAI first.
- If the OpenAI request fails or the account has no usable quota, the endpoint falls back to local text generation.
- The server logs OpenAI request attempts and truncated responses to help with debugging.

## Database

- SQLite is initialized automatically when the app starts.
- The database file lives in `data/task-master.db`.
- No manual migration step is required for a clean local setup.

## Testing and Smoke Checks

```bash
npm test
```

There is also an end-to-end smoke script for local verification:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\smoke_e2e.ps1
```

## Notes

- The API listens on port `3000` by default.
- If `OPENAI_API_KEY` is missing or invalid, AI generation falls back to local output.
- The current implementation is intended for local development and evaluation, not production deployment without further hardening.