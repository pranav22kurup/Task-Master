# Task Master API

Task Master is a REST API for team task tracking, collaboration, notifications, and AI-assisted task writing.

## Setup

1. Copy [.env.example](.env.example) to `.env` and set your values.
2. Install dependencies with `npm install`.
3. Start development mode with `npm run dev`.

## Core Endpoints

### Auth

- `POST /auth/register` - create a new account
- `POST /auth/login` - log in and receive a JWT
- `POST /auth/logout` - revoke the current JWT
- `GET /auth/me` - view the current profile
- `PATCH /auth/me` - update profile data

### Tasks

- `POST /tasks` - create a task
- `GET /tasks` - list tasks with filters, sorting, and search
- `GET /tasks/:id` - fetch one task
- `PATCH /tasks/:id` - update a task
- `DELETE /tasks/:id` - delete a task
- `GET /tasks/:taskId/comments` - list comments
- `POST /tasks/:taskId/comments` - add a comment
- `DELETE /tasks/:taskId/comments/:commentId` - delete your own comment
- `GET /tasks/:taskId/attachments` - list attachments
- `POST /tasks/:taskId/attachments` - add an attachment
- `DELETE /tasks/:taskId/attachments/:attachmentId` - delete an attachment

### Teams and Projects

- `POST /teams` - create a team
- `GET /teams` - list teams you belong to
- `GET /teams/:id` - view a team
- `POST /teams/join` - join a team by code
- `POST /projects` - create a project
- `GET /projects` - list projects you belong to
- `GET /projects/:id` - view a project
- `POST /projects/join` - join a project by code

### Notifications

- `GET /notifications` - list notifications
- `GET /notifications/stream` - real-time SSE stream
- `POST /notifications/:id/read` - mark one notification as read

### AI

- `POST /ai/tasks/generate` - generate a task description or summary

## Request Examples

### Register

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"StrongPass123"}'
```

### Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"StrongPass123"}'
```

### Create a Task

```bash
curl -X POST http://localhost:3000/tasks \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Prepare sprint demo",
    "description":"Collect release notes and screenshots",
    "dueDate":"2026-06-10",
    "status":"todo",
    "priority":"high"
  }'
```

### Filter and Search Tasks

```bash
curl "http://localhost:3000/tasks?status=todo&search=demo&sortBy=dueDate&sortOrder=asc" \
  -H "Authorization: Bearer YOUR_JWT"
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
    "title":"Launch checklist",
    "context":"Need a concise description for the release task",
    "mode":"description",
    "tone":"clear"
  }'
```

## Notes

- Authentication uses JWT bearer tokens.
- Real-time notifications use Server-Sent Events.
- If `OPENAI_API_KEY` is not configured, the AI endpoint falls back to local generation.