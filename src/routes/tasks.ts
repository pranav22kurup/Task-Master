import { Router } from 'express';
import type { AppDatabase } from '../db/database';
import { requireAuth, type AuthenticatedRequest } from '../auth';
import { validateBody } from '../middleware/validate';
import { createTaskSchema } from '../schemas/task';
import { addNotifications } from '../notifications';

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeId: number | null;
  teamId: number | null;
  projectId: number | null;
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
  teamId: number | null;
  projectId: number | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

const allowedStatuses = new Set(['todo', 'in-progress', 'done', 'blocked']);
const allowedPriorities = new Set(['low', 'medium', 'high', 'urgent']);
const allowedSortFields = new Set(['createdAt', 'updatedAt', 'dueDate', 'title', 'status', 'priority']);

function loadTeam(database: AppDatabase, teamId: number) {
  return database.prepare('SELECT id FROM teams WHERE id = ?').get(teamId) as { id: number } | undefined;
}

function loadProject(database: AppDatabase, projectId: number) {
  return database.prepare('SELECT id, teamId FROM projects WHERE id = ?').get(projectId) as { id: number; teamId: number | null } | undefined;
}

function userIsTeamMember(database: AppDatabase, teamId: number, userId: number) {
  const member = database
    .prepare('SELECT teamId FROM team_members WHERE teamId = ? AND userId = ?')
    .get(teamId, userId) as { teamId: number } | undefined;

  return Boolean(member);
}

function userIsProjectMember(database: AppDatabase, projectId: number, userId: number) {
  const member = database
    .prepare('SELECT projectId FROM project_members WHERE projectId = ? AND userId = ?')
    .get(projectId, userId) as { projectId: number } | undefined;

  return Boolean(member);
}

function getTaskNotificationRecipients(database: AppDatabase, task: TaskRow, actorId: number) {
  const recipientIds = new Set<number>();

  if (task.assigneeId !== null && task.assigneeId !== actorId) {
    recipientIds.add(task.assigneeId);
  }

  if (task.teamId !== null) {
    const teamMembers = database
      .prepare('SELECT userId FROM team_members WHERE teamId = ?')
      .all(task.teamId) as Array<{ userId: number }>;

    for (const member of teamMembers) {
      if (member.userId !== actorId) {
        recipientIds.add(member.userId);
      }
    }
  }

  if (task.projectId !== null) {
    const projectMembers = database
      .prepare('SELECT userId FROM project_members WHERE projectId = ?')
      .all(task.projectId) as Array<{ userId: number }>;

    for (const member of projectMembers) {
      if (member.userId !== actorId) {
        recipientIds.add(member.userId);
      }
    }
  }

  recipientIds.delete(actorId);
  return recipientIds;
}

function mapTask(task: TaskRow): TaskResponse {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeId: task.assigneeId,
    teamId: task.teamId,
    projectId: task.projectId,
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

  const teamId = parseOptionalId(query.teamId);
  if (teamId === null) {
    return { error: 'Invalid teamId filter.', conditions, parameters } as const;
  }

  if (teamId !== undefined) {
    conditions.push('teamId = ?');
    parameters.push(teamId);
  }

  const projectId = parseOptionalId(query.projectId);
  if (projectId === null) {
    return { error: 'Invalid projectId filter.', conditions, parameters } as const;
  }

  if (projectId !== undefined) {
    conditions.push('projectId = ?');
    parameters.push(projectId);
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

  router.post('/', validateBody(createTaskSchema), (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const { title, description, dueDate, status, priority, assigneeId, teamId, projectId } = request.body as {
      title?: string;
      description?: string | null;
      dueDate?: string | null;
      status?: string;
      priority?: string;
      assigneeId?: number | undefined;
      teamId?: number | undefined;
      projectId?: number | undefined;
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

    const normalizedTeamId = parseOptionalId(teamId);
    if (normalizedTeamId === null) {
      response.status(400).json({ error: 'Invalid teamId.' });
      return;
    }

    if (normalizedTeamId !== undefined) {
      const team = loadTeam(database, normalizedTeamId);

      if (!team) {
        response.status(400).json({ error: 'Team does not exist.' });
        return;
      }

      if (!userIsTeamMember(database, normalizedTeamId, currentUser.id)) {
        response.status(403).json({ error: 'You must be a team member to create tasks in that team.' });
        return;
      }
    }

    const normalizedProjectId = parseOptionalId(projectId);
    if (normalizedProjectId === null) {
      response.status(400).json({ error: 'Invalid projectId.' });
      return;
    }

    let resolvedTeamId = normalizedTeamId;

    if (normalizedProjectId !== undefined) {
      const project = loadProject(database, normalizedProjectId);

      if (!project) {
        response.status(400).json({ error: 'Project does not exist.' });
        return;
      }

      if (!userIsProjectMember(database, normalizedProjectId, currentUser.id)) {
        response.status(403).json({ error: 'You must be a project member to create tasks in that project.' });
        return;
      }

      if (project.teamId !== null) {
        if (resolvedTeamId !== undefined && resolvedTeamId !== project.teamId) {
          response.status(400).json({ error: 'Project must belong to the selected team.' });
          return;
        }

        resolvedTeamId = project.teamId;
      }
    }

    if (normalizedAssigneeId !== undefined) {
      if (resolvedTeamId !== undefined && !userIsTeamMember(database, resolvedTeamId, normalizedAssigneeId)) {
        response.status(400).json({ error: 'Assignee must be a member of the selected team.' });
        return;
      }

      if (normalizedProjectId !== undefined && !userIsProjectMember(database, normalizedProjectId, normalizedAssigneeId)) {
        response.status(400).json({ error: 'Assignee must be a member of the selected project.' });
        return;
      }
    }

    const normalizedDueDate = isNonEmptyString(dueDate) ? dueDate.trim() : null;

    const result = database
      .prepare(
        `INSERT INTO tasks (title, description, status, priority, assigneeId, teamId, projectId, dueDate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        title.trim(),
        isNonEmptyString(description) ? description.trim() : null,
        normalizedStatus,
        normalizedPriority,
        normalizedAssigneeId ?? null,
        resolvedTeamId ?? null,
        normalizedProjectId ?? null,
        normalizedDueDate
      );

    const task = database
      .prepare('SELECT id, title, description, status, priority, assigneeId, teamId, projectId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(result.lastInsertRowid) as TaskRow | undefined;

    if (task) {
      addNotifications(database, getTaskNotificationRecipients(database, task, currentUser.id), {
        type: 'task.created',
        title: 'Task created',
        message: `${currentUser.name} created ${task.title}.`,
        entityType: 'task',
        entityId: task.id,
        metadata: { taskId: task.id, actorId: currentUser.id },
      });
    }

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
        `SELECT id, title, description, status, priority, assigneeId, teamId, projectId, dueDate, createdAt, updatedAt
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
      .prepare('SELECT id, title, description, status, priority, assigneeId, teamId, projectId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    if (!task) {
      response.status(404).json({ error: 'Task not found.' });
      return;
    }

    response.json({ task: mapTask(task) });
  });

  router.patch('/:id', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const id = Number(request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid task id.' });
      return;
    }

    const task = database
      .prepare('SELECT id, title, description, status, priority, assigneeId, teamId, projectId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    if (!task) {
      response.status(404).json({ error: 'Task not found.' });
      return;
    }

    const { title, description, dueDate, status, priority, assigneeId, teamId, projectId } = request.body as {
      title?: unknown;
      description?: unknown;
      dueDate?: unknown;
      status?: unknown;
      priority?: unknown;
      assigneeId?: unknown;
      teamId?: unknown;
      projectId?: unknown;
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

    let nextTeamId = task.teamId;

    if (teamId !== undefined) {
      const normalizedTeamId = parseOptionalId(teamId);

      if (normalizedTeamId === null) {
        response.status(400).json({ error: 'Invalid teamId.' });
        return;
      }

      if (normalizedTeamId !== undefined) {
        const team = loadTeam(database, normalizedTeamId);

        if (!team) {
          response.status(400).json({ error: 'Team does not exist.' });
          return;
        }

        if (!userIsTeamMember(database, normalizedTeamId, currentUser.id)) {
          response.status(403).json({ error: 'You must be a team member to move tasks into that team.' });
          return;
        }
      }

      nextTeamId = normalizedTeamId ?? null;
      updates.push('teamId = ?');
      parameters.push(nextTeamId);
    }

    if (projectId !== undefined) {
      const normalizedProjectId = parseOptionalId(projectId);

      if (normalizedProjectId === null) {
        response.status(400).json({ error: 'Invalid projectId.' });
        return;
      }

      if (normalizedProjectId !== undefined) {
        const project = loadProject(database, normalizedProjectId);

        if (!project) {
          response.status(400).json({ error: 'Project does not exist.' });
          return;
        }

        if (!userIsProjectMember(database, normalizedProjectId, currentUser.id)) {
          response.status(403).json({ error: 'You must be a project member to move tasks into that project.' });
          return;
        }

        if (project.teamId !== null) {
          if (nextTeamId !== null && nextTeamId !== undefined && nextTeamId !== project.teamId) {
            response.status(400).json({ error: 'Project must belong to the selected team.' });
            return;
          }

          if (nextTeamId === task.teamId) {
            nextTeamId = project.teamId;
            updates.push('teamId = ?');
            parameters.push(nextTeamId);
          }
        }
      }

      updates.push('projectId = ?');
      parameters.push(normalizedProjectId ?? null);
    }

    const effectiveTeamId = teamId !== undefined ? nextTeamId : task.teamId;
    const effectiveProjectId = projectId !== undefined ? parseOptionalId(projectId) : task.projectId;

    if (assigneeId !== undefined) {
      const normalizedAssigneeId = parseOptionalId(assigneeId);
      if (normalizedAssigneeId !== undefined && normalizedAssigneeId !== null) {
        if (effectiveTeamId !== undefined && effectiveTeamId !== null && !userIsTeamMember(database, effectiveTeamId, normalizedAssigneeId)) {
          response.status(400).json({ error: 'Assignee must be a member of the selected team.' });
          return;
        }

        if (effectiveProjectId !== undefined && effectiveProjectId !== null && !userIsProjectMember(database, effectiveProjectId, normalizedAssigneeId)) {
          response.status(400).json({ error: 'Assignee must be a member of the selected project.' });
          return;
        }
      }
    }

    if (updates.length === 0) {
      response.status(400).json({ error: 'Provide at least one field to update.' });
      return;
    }

    updates.push('updatedAt = CURRENT_TIMESTAMP');
    parameters.push(id);

    database.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...parameters);

    const updatedTask = database
      .prepare('SELECT id, title, description, status, priority, assigneeId, teamId, projectId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    if (updatedTask) {
      addNotifications(database, getTaskNotificationRecipients(database, updatedTask, currentUser.id), {
        type: 'task.updated',
        title: 'Task updated',
        message: `${currentUser.name} updated ${updatedTask.title}.`,
        entityType: 'task',
        entityId: updatedTask.id,
        metadata: { taskId: updatedTask.id, actorId: currentUser.id },
      });
    }

    response.json({ task: updatedTask ? mapTask(updatedTask) : null });
  });

  router.delete('/:id', (_request: AuthenticatedRequest, response) => {
    const currentUser = _request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const id = Number(_request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid task id.' });
      return;
    }

    const task = database
      .prepare('SELECT id, title, description, status, priority, assigneeId, teamId, projectId, dueDate, createdAt, updatedAt FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    const deleted = database.prepare('DELETE FROM tasks WHERE id = ?').run(id);

    if (deleted.changes === 0) {
      response.status(404).json({ error: 'Task not found.' });
      return;
    }

    if (task) {
      addNotifications(database, getTaskNotificationRecipients(database, task, currentUser.id), {
        type: 'task.deleted',
        title: 'Task deleted',
        message: `${currentUser.name} deleted ${task.title}.`,
        entityType: 'task',
        entityId: task.id,
        metadata: { taskId: task.id, actorId: currentUser.id },
      });
    }

    response.status(204).send();
  });

  return router;
}