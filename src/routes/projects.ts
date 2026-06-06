import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth';
import type { AppDatabase } from '../db/database';
import { addNotifications } from '../notifications';

interface ProjectRow {
  id: number;
  teamId: number | null;
  name: string;
  description: string | null;
  ownerId: number;
  joinCode: string;
  createdAt: string;
  updatedAt: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function generateJoinCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

function mapProject(project: ProjectRow) {
  return {
    id: project.id,
    teamId: project.teamId,
    name: project.name,
    description: project.description,
    ownerId: project.ownerId,
    joinCode: project.joinCode,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function createProjectRouter(database: AppDatabase) {
  const router = Router();

  router.use(requireAuth);

  router.get('/', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const projects = database
      .prepare(
        `SELECT p.id, p.teamId, p.name, p.description, p.ownerId, p.joinCode, p.createdAt, p.updatedAt
         FROM projects p
         INNER JOIN project_members pm ON pm.projectId = p.id
         WHERE pm.userId = ?
         ORDER BY p.createdAt DESC`
      )
      .all(currentUser.id) as ProjectRow[];

    response.json({ projects: projects.map(mapProject) });
  });

  router.post('/', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const { name, description, teamId } = request.body as {
      name?: unknown;
      description?: unknown;
      teamId?: unknown;
    };

    if (!isNonEmptyString(name)) {
      response.status(400).json({ error: 'Project name is required.' });
      return;
    }

    const normalizedTeamId = typeof teamId === 'undefined' || teamId === null || teamId === '' ? undefined : Number(teamId);
    if (normalizedTeamId !== undefined && (!Number.isInteger(normalizedTeamId) || normalizedTeamId <= 0)) {
      response.status(400).json({ error: 'Invalid teamId.' });
      return;
    }

    if (normalizedTeamId !== undefined) {
      const membership = database
        .prepare('SELECT 1 FROM team_members WHERE teamId = ? AND userId = ?')
        .get(normalizedTeamId, currentUser.id) as { '1': number } | undefined;

      if (!membership) {
        response.status(403).json({ error: 'You must join the team before creating a project in it.' });
        return;
      }
    }

    const joinCode = generateJoinCode();
    const result = database
      .prepare(
        `INSERT INTO projects (teamId, name, description, ownerId, joinCode)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(normalizedTeamId ?? null, name.trim(), isNonEmptyString(description) ? description.trim() : null, currentUser.id, joinCode);

    database
      .prepare('INSERT INTO project_members (projectId, userId, role) VALUES (?, ?, ?)')
      .run(result.lastInsertRowid, currentUser.id, 'owner');

    addNotifications(database, [currentUser.id], {
      type: 'project.created',
      title: 'Project created',
      message: `You created ${name.trim()}.`,
      entityType: 'project',
      entityId: Number(result.lastInsertRowid),
      metadata: { projectId: Number(result.lastInsertRowid) },
    });

    const project = database
      .prepare('SELECT id, teamId, name, description, ownerId, joinCode, createdAt, updatedAt FROM projects WHERE id = ?')
      .get(result.lastInsertRowid) as ProjectRow | undefined;

    response.status(201).json({ project: project ? mapProject(project) : null });
  });

  router.post('/join', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const { joinCode } = request.body as { joinCode?: unknown };

    if (!isNonEmptyString(joinCode)) {
      response.status(400).json({ error: 'Join code is required.' });
      return;
    }

    const project = database.prepare('SELECT id, teamId FROM projects WHERE joinCode = ?').get(joinCode.trim().toUpperCase()) as { id: number; teamId: number | null } | undefined;

    if (!project) {
      response.status(404).json({ error: 'Project not found.' });
      return;
    }

    if (project.teamId !== null) {
      database.prepare('INSERT OR IGNORE INTO team_members (teamId, userId, role) VALUES (?, ?, ?)').run(project.teamId, currentUser.id, 'member');
    }

    database.prepare('INSERT OR IGNORE INTO project_members (projectId, userId, role) VALUES (?, ?, ?)').run(project.id, currentUser.id, 'member');

    const owner = database
      .prepare('SELECT ownerId, name FROM projects WHERE id = ?')
      .get(project.id) as { ownerId: number; name: string } | undefined;

    if (owner) {
      addNotifications(database, [owner.ownerId], {
        type: 'project.joined',
        title: 'Project joined',
        message: `${currentUser.name} joined ${owner.name}.`,
        entityType: 'project',
        entityId: project.id,
        metadata: { projectId: project.id, actorId: currentUser.id },
      });
    }

    const joinedProject = database
      .prepare('SELECT id, teamId, name, description, ownerId, joinCode, createdAt, updatedAt FROM projects WHERE id = ?')
      .get(project.id) as ProjectRow | undefined;

    response.json({ project: joinedProject ? mapProject(joinedProject) : null });
  });

  router.get('/:id', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const id = Number(request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid project id.' });
      return;
    }

    const membership = database
      .prepare('SELECT 1 FROM project_members WHERE projectId = ? AND userId = ?')
      .get(id, currentUser.id) as { '1': number } | undefined;

    if (!membership) {
      response.status(403).json({ error: 'You are not a member of this project.' });
      return;
    }

    const project = database
      .prepare('SELECT id, teamId, name, description, ownerId, joinCode, createdAt, updatedAt FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;

    if (!project) {
      response.status(404).json({ error: 'Project not found.' });
      return;
    }

    response.json({ project: mapProject(project) });
  });

  return router;
}