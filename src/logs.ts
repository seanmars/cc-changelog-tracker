import type { DatabaseSync } from 'node:sqlite';

export type LogLevel = 'info' | 'error';

export type Logger = (level: LogLevel, message: string) => void;

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
}

export interface LogStore {
  add(level: LogLevel, message: string): void;
  recent(limit: number): LogEntry[];
}

// 只保留最新的 maxEntries 筆, 避免 DB 一直變大.
export function openLogStore(db: DatabaseSync, maxEntries = 1000): LogStore {
  db.exec(
    `CREATE TABLE IF NOT EXISTS logs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       time TEXT NOT NULL,
       level TEXT NOT NULL,
       message TEXT NOT NULL
     ) STRICT`,
  );

  const insert = db.prepare('INSERT INTO logs (time, level, message) VALUES (?, ?, ?)');
  const prune = db.prepare('DELETE FROM logs WHERE id <= ?');
  const selectRecent = db.prepare('SELECT id, time, level, message FROM logs ORDER BY id DESC LIMIT ?');

  return {
    add: (level, message) => {
      const { lastInsertRowid } = insert.run(new Date().toISOString(), level, message);
      prune.run(Number(lastInsertRowid) - maxEntries);
    },
    recent: (limit) => selectRecent.all(limit) as unknown as LogEntry[],
  };
}
