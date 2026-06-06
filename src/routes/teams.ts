import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth';
import type { AppDatabase } from '../db/database';
import { addNotifications } from '../notifications';

interface TeamRow {
  id: number;
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

function mapTeam(team: TeamRow) {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    ownerId: team.ownerId,
    joinCode: team.joinCode,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

export function createTeamRouter(database: AppDatabase) {
  const router = Router();

  router.use(requireAuth);

  router.get('/', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const teams = database
      .prepare(
        `SELECT t.id, t.name, t.description, t.ownerId, t.joinCode, t.createdAt, t.updatedAt
         FROM teams t
         INNER JOIN team_members tm ON tm.teamId = t.id
         WHERE tm.userId = ?
         ORDER BY t.createdAt DESC`
      )
      .all(currentUser.id) as TeamRow[];

    response.json({ teams: teams.map(mapTeam) });
  });

  router.post('/', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const { name, description } = request.body as {
      name?: unknown;
      description?: unknown;
    };

    if (!isNonEmptyString(name)) {
      response.status(400).json({ error: 'Team name is required.' });
      return;
    }

    const joinCode = generateJoinCode();
    const result = database
      .prepare(
        `INSERT INTO teams (name, description, ownerId, joinCode)
         VALUES (?, ?, ?, ?)`
      )
      .run(name.trim(), isNonEmptyString(description) ? description.trim() : null, currentUser.id, joinCode);

    database
      .prepare('INSERT INTO team_members (teamId, userId, role) VALUES (?, ?, ?)')
      .run(result.lastInsertRowid, currentUser.id, 'owner');

    addNotifications(database, [currentUser.id], {
      type: 'team.created',
      title: 'Team created',
      message: `You created ${name.trim()}.`,
      entityType: 'team',
      entityId: Number(result.lastInsertRowid),
      metadata: { teamId: Number(result.lastInsertRowid) },
    });

    const team = database
      .prepare('SELECT id, name, description, ownerId, joinCode, createdAt, updatedAt FROM teams WHERE id = ?')
      .get(result.lastInsertRowid) as TeamRow | undefined;

    response.status(201).json({ team: team ? mapTeam(team) : null });
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

    const team = database.prepare('SELECT id FROM teams WHERE joinCode = ?').get(joinCode.trim().toUpperCase()) as { id: number } | undefined;

    if (!team) {
      response.status(404).json({ error: 'Team not found.' });
      return;
    }

    database.prepare('INSERT OR IGNORE INTO team_members (teamId, userId, role) VALUES (?, ?, ?)').run(team.id, currentUser.id, 'member');

    const owner = database
      .prepare('SELECT ownerId, name FROM teams WHERE id = ?')
      .get(team.id) as { ownerId: number; name: string } | undefined;

    if (owner) {
      addNotifications(database, [owner.ownerId], {
        type: 'team.joined',
        title: 'Team joined',
        message: `${currentUser.name} joined ${owner.name}.`,
        entityType: 'team',
        entityId: team.id,
        metadata: { teamId: team.id, actorId: currentUser.id },
      });
    }

    const joinedTeam = database
      .prepare('SELECT id, name, description, ownerId, joinCode, createdAt, updatedAt FROM teams WHERE id = ?')
      .get(team.id) as TeamRow | undefined;

    response.json({ team: joinedTeam ? mapTeam(joinedTeam) : null });
  });

  router.get('/:id', (request: AuthenticatedRequest, response) => {
    const currentUser = request.user;

    if (!currentUser) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const id = Number(request.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      response.status(400).json({ error: 'Invalid team id.' });
      return;
    }

    const membership = database
      .prepare('SELECT 1 FROM team_members WHERE teamId = ? AND userId = ?')
      .get(id, currentUser.id) as { '1': number } | undefined;

    if (!membership) {
      response.status(403).json({ error: 'You are not a member of this team.' });
      return;
    }

    const team = database
      .prepare('SELECT id, name, description, ownerId, joinCode, createdAt, updatedAt FROM teams WHERE id = ?')
      .get(id) as TeamRow | undefined;

    if (!team) {
      response.status(404).json({ error: 'Team not found.' });
      return;
    }

    response.json({ team: mapTeam(team) });
  });

  return router;
}