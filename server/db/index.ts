import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const DB_PATH = process.env.HALLWAY_DB || "./hallway.db";

const sqlite = new Database(DB_PATH);
sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };

// Create tables if they don't exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS organisms (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    parent_id TEXT,
    generation INTEGER NOT NULL DEFAULT 0,
    credits REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'spawning',
    container_id TEXT,
    kernel_hash TEXT,
    total_earned REAL NOT NULL DEFAULT 0,
    total_spent REAL NOT NULL DEFAULT 0,
    tasks_completed INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0,
    children_spawned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    died_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    fixture TEXT NOT NULL,
    organism_id TEXT REFERENCES organisms(id),
    status TEXT NOT NULL DEFAULT 'available',
    score INTEGER,
    breakdown TEXT,
    work_dir TEXT,
    assigned_at INTEGER,
    submitted_at INTEGER,
    scored_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organism_id TEXT NOT NULL REFERENCES organisms(id),
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    balance REAL NOT NULL,
    detail TEXT,
    related_organism_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL REFERENCES organisms(id),
    to_id TEXT,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);
