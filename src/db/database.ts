import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDirectory = path.resolve(process.cwd(), 'data');
const databaseFile = path.join(dataDirectory, 'task-master.db');

function getTableColumns(database: any, tableName: string) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
}

function ensureColumn(database: any, tableName: string, columnName: string, columnDefinition: string) {
  const columns = getTableColumns(database, tableName);

  if (!columns.some((column) => column.name === columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

export function initializeDatabase() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }

  const database = new Database(databaseFile);

  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      ownerId INTEGER NOT NULL,
      joinCode TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_members (
      teamId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (teamId, userId),
      FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teamId INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      ownerId INTEGER NOT NULL,
      joinCode TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (ownerId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_members (
      projectId INTEGER NOT NULL,
      userId INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (projectId, userId),
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigneeId INTEGER,
      teamId INTEGER,
      projectId INTEGER,
      dueDate TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (assigneeId) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId INTEGER NOT NULL,
      authorId INTEGER,
      body TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taskId INTEGER NOT NULL,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);

  const tasksColumns = database.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  const taskColumnNames = new Set(tasksColumns.map((column) => column.name));

  if (!taskColumnNames.has('teamId')) {
    ensureColumn(database, 'tasks', 'teamId', 'INTEGER');
  }

  if (!taskColumnNames.has('projectId')) {
    ensureColumn(database, 'tasks', 'projectId', 'INTEGER');
  }

  return database;
}

export type AppDatabase = ReturnType<typeof initializeDatabase>;