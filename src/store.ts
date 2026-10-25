import type { DatabaseSync } from 'node:sqlite';
import type { ClassifiedRelease } from './categories.ts';

export interface ReleaseStore {
  put(release: ClassifiedRelease): void;
  get(version: string): ClassifiedRelease | undefined;
}

// key 是版本號, value 是翻譯後的 release JSON. 同一版本重複處理時會覆寫.
export function openReleaseStore(db: DatabaseSync): ReleaseStore {
  db.exec('CREATE TABLE IF NOT EXISTS releases (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');

  const upsert = db.prepare(
    'INSERT INTO releases (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const select = db.prepare('SELECT value FROM releases WHERE key = ?');

  return {
    put: (release) => {
      upsert.run(release.version, JSON.stringify(release));
    },
    get: (version) => {
      const row = select.get(version) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as ClassifiedRelease) : undefined;
    },
  };
}
