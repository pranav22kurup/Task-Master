import { Router } from 'express';
import type { AppDatabase } from '../db/database';
import { requireAuth, type AuthenticatedRequest } from '../auth';

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TaskResponse {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

const allowedStatuses = new Set(['todo', 'in-progress', 'done', 'blocked']);
const allowedPriorities = new Set(['low', 'medium', 'high', 'urgent']);
const allowedSortFields = new Set(['createdAt', 'updatedAt', 'dueDate', 'title', 'status', 'priority']);

function mapTask(task: TaskRow): TaskResponse {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseOptionalId(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildSearchFilters(query: Record<string, unknown>) {
  const conditions: string[] = [];
  const parameters: Array<string | number> = [];

  if (isNonEmptyString(query.search)) {
    conditions.push('(title LIKE ? OR description LIKE ?)');
    const searchValue = `%${query.search.trim()}%`;
    parameters.push(searchValue, searchValue);
  }

  if (isNonEmptyString(query.status)) {
    const status = query.status.trim();
    if (!allowedStatuses.has(status)) {
      return { error: 'Invalid status filter.', conditions, parameters } as const;
    }

    conditions.push('status = ?');
    parameters.push(status);
  }

  if (isNonEmptyString(query.priority)) {
    const priority = query.priority.trim();
    if (!allowedPriorities.has(priority)) {
      return { error: 'Invalid priority filter.', conditions, parameters } as const;
    }

    conditions.push('priority = ?');
    parameters.push(priority);
  }

  const assigneeId = parseOptionalId(query.assigneeId);
  if (assigneeId === null) {
    return { error: 'Invalid assigneeId filter.', conditions, parameters } as const;
  }

  if (assigneeId !== undefined) {
    conditions.push('assigneeId = ?');
    parameters.push(assigneeId);
  }

  if (isNonEmptyString(query.dueBefore)) {
    conditions.push('dueDate <= ?');
    parameters.push(query.dueBefore.trim());
  }

  if (isNonEmptyString(query.dueAfter)) {
    conditions.push('dueDate >= ?');
    parameters.push(query.dueAfter.trim());
  }

  return { conditions, parameters } as const;
}

function getSortClause(query: Record<string, unknown>) {
  const sortBy = isNonEmptyString(query.sortBy) ? query.sortBy.trim() : 'createdAt';
  const sortOrder = isNonEmptyString(query.sortOrder) && query.sortOrder.trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  if (!allowedSortFields.has(sortBy)) {
    return { error: 'Invalid sortBy value.' } as const;
  }

  return { clause: `${sortBy} ${sortOrder}` } as const;
}

export function createTaskRouter(database: AppDatabase) {
  const router = Router();

  router.use(requireAuth);

  router.post('/', (request: AuthenticatedRequest, response) => {
    const { title, description, dueDate, status, priority, assigneeId } = request.body as {
      title?: unknown;
      description?: unknown;
      dueDate?: unknown;
      status?: unknown;
      priority?: unknown;
      assigneeId?: unknown;
    };

    if (!isNonEmptyString(title)) {
      response.status(400).json({ error: 'Title is required.' });
      return;
    }

    const normalizedStatus = isNonEmptyString(status) ? status.trim() : 'todo';
    if (!allowedStatuses.has(normalizedStatus)) {
      response.status(400).json({ error: 'Invalid task status.' });
      return;
    }

    const normalizedPriority = isNonEmptyString(priority) ? priority.trim() : 'medium';
    if (!allowedPriorities.has(normalizedPriority)) {
      response.status(400).json({ error: 'Invalid task priority.' });
      return;
    }

    const normalizedAssigneeId = parseOptionalId(assigneeId);
    if (normalizedAssigneeId === null) {
      response.status(400).json({ error: 'Invalid assigneeId.' });
      return;
    }

    if (normalizedAssigneeId !== undefined) {
      const assignee = database.prepare('SELECT id FROM users WHERE id = ?').get(normalizedAssigneeId) as { id: number } | undefined;
      if (!assignee) {
        response.status(400).json({ error: 'Assignee does not exist.' });
        return;
      }
    }

    const normalizedDueDate = isNonEmptyString(dueDate) ? dueDate.trim() : null;

    const result = database
      .prepare(
        `INSERT INTO tasks (title, description, status, priority, assigneeId, dueDate)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        title.trim(),
        isNonEmptyString(description) ? description.trim() : null,
        normalizedStatus,
        normalizedPriority,
        normalizedAssigneeId ?? null,
        normalizedDueDate
      );

    const task = database
      .prepare('SELECT id, title, description, status, priority, assigneeId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(result.lastInsertRowid) as TaskRow | undefined;

    response.status(201).json({ task: task ? mapTask(task) : null });
  });

  router.get('/', (request, response) => {
    const filters = buildSearchFilters(request.query as Record<string, unknown>);

    if ('error' in filters) {
      response.status(400).json({ error: filters.error });
      return;
    }

    const sort = getSortClause(request.query as Record<string, unknown>);

    if ('error' in sort) {
      response.status(400).json({ error: sort.error });
      return;
    }

    const whereClause = filters.conditions.length > 0 ? `WHERE ${filters.conditions.join(' AND ')}` : '';
    const tasks = database
      .prepare(
        `SELECT id, title, description, status, priority, assigneeId, dueDate, createdAt, updatedAt
         FROM tasks
         ${whereClause}
         ORDER BY ${sort.clause}`
      )
      .all(...filters.parameters) as TaskRow[];

    response.json({ tasks: tasks.map(mapTask) });
  });

  router.get('/:id', (request, response) => {
    const id = Number(request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid task id.' });
      return;
    }

    const task = database
      .prepare('SELECT id, title, description, status, priority, assigneeId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    if (!task) {
      response.status(404).json({ error: 'Task not found.' });
      return;
    }

    response.json({ task: mapTask(task) });
  });

  router.patch('/:id', (request: AuthenticatedRequest, response) => {
    const id = Number(request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid task id.' });
      return;
    }

    const task = database
      .prepare('SELECT id, title, description, status, priority, assigneeId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    if (!task) {
      response.status(404).json({ error: 'Task not found.' });
      return;
    }

    const { title, description, dueDate, status, priority, assigneeId } = request.body as {
      title?: unknown;
      description?: unknown;
      dueDate?: unknown;
      status?: unknown;
      priority?: unknown;
      assigneeId?: unknown;
    };

    const updates: string[] = [];
    const parameters: Array<string | number | null> = [];

    if (title !== undefined) {
      if (!isNonEmptyString(title)) {
        response.status(400).json({ error: 'Title cannot be empty.' });
        return;
      }

      updates.push('title = ?');
      parameters.push(title.trim());
    }

    if (description !== undefined) {
      updates.push('description = ?');
      parameters.push(isNonEmptyString(description) ? description.trim() : null);
    }

    if (dueDate !== undefined) {
      updates.push('dueDate = ?');
      parameters.push(isNonEmptyString(dueDate) ? dueDate.trim() : null);
    }

    if (status !== undefined) {
      if (!isNonEmptyString(status) || !allowedStatuses.has(status.trim())) {
        response.status(400).json({ error: 'Invalid task status.' });
        return;
      }

      updates.push('status = ?');
      parameters.push(status.trim());
    }

    if (priority !== undefined) {
      if (!isNonEmptyString(priority) || !allowedPriorities.has(priority.trim())) {
        response.status(400).json({ error: 'Invalid task priority.' });
        return;
      }

      updates.push('priority = ?');
      parameters.push(priority.trim());
    }

    if (assigneeId !== undefined) {
      const normalizedAssigneeId = parseOptionalId(assigneeId);

      if (normalizedAssigneeId === null) {
        response.status(400).json({ error: 'Invalid assigneeId.' });
        return;
      }

      if (normalizedAssigneeId !== undefined) {
        const assignee = database.prepare('SELECT id FROM users WHERE id = ?').get(normalizedAssigneeId) as { id: number } | undefined;
        if (!assignee) {
          response.status(400).json({ error: 'Assignee does not exist.' });
          return;
        }
      }

      updates.push('assigneeId = ?');
      parameters.push(normalizedAssigneeId ?? null);
    }

    if (updates.length === 0) {
      response.status(400).json({ error: 'Provide at least one field to update.' });
      return;
    }

    updates.push('updatedAt = CURRENT_TIMESTAMP');
    parameters.push(id);

    database.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...parameters);

    const updatedTask = database
      .prepare('SELECT id, title, description, status, priority, assigneeId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    response.json({ task: updatedTask ? mapTask(updatedTask) : null });
  });

  router.delete('/:id', (_request: AuthenticatedRequest, response) => {
    const id = Number(_request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid task id.' });
      return;
    }

    const deleted = database.prepare('DELETE FROM tasks WHERE id = ?').run(id);

    if (deleted.changes === 0) {
      response.status(404).json({ error: 'Task not found.' });
      return;
    }

    response.status(204).send();
  });

  return router;
}