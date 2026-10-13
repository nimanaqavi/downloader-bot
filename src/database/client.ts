import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runMigrations } from "./migrations.js";

export function createDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL"); // ponytail: reduces disk write I/O significantly on budget VPS in WAL mode
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("cache_size = -2000"); // ponytail: 2MB RAM cache ceiling for 256MB RAM environment
  db.pragma("mmap_size = 0");
  runMigrations(db);
  return db;
}
