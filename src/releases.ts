import type { DatabaseSync } from 'node:sqlite';
import type { ClassifiedRelease } from './categories.ts';
import { compareVersions } from './changelog.ts';

export interface ReleaseStore {
  // release 是翻譯後的結果, source 是翻譯前 (分類後) 的英文原文.
  put(release: ClassifiedRelease, source: ClassifiedRelease): void;
  get(version: string): ClassifiedRelease | undefined;
  getSource(version: string): ClassifiedRelease | undefined;
  list(): ClassifiedRelease[];
}

// 兩個 table 的 key 都是版本號. releases 存翻譯後的 release JSON, release_sources 存翻譯前的原文,
// 重新翻譯時使用. 同一版本重複處理時會覆寫.
export function openReleaseStore(db: DatabaseSync): ReleaseStore {
  db.exec('CREATE TABLE IF NOT EXISTS releases (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
  db.exec('CREATE TABLE IF NOT EXISTS release_sources (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');

  const upsert = db.prepare(
    'INSERT INTO releases (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const upsertSource = db.prepare(
    'INSERT INTO release_sources (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const select = db.prepare('SELECT value FROM releases WHERE key = ?');
  const selectSource = db.prepare('SELECT value FROM release_sources WHERE key = ?');
  const selectAll = db.prepare('SELECT value FROM releases');

  return {
    put: (release, source) => {
      // 翻譯結果和原文放在同一個 transaction, 不會只存一半.
      db.exec('BEGIN');
      try {
        upsert.run(release.version, JSON.stringify(release));
        upsertSource.run(source.version, JSON.stringify(source));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    get: (version) => {
      const row = select.get(version) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as ClassifiedRelease) : undefined;
    },
    getSource: (version) => {
      const row = selectSource.get(version) as { value: string } | undefined;
      return row ? (JSON.parse(row.value) as ClassifiedRelease) : undefined;
    },
    // 由新到舊排序. key 是文字, SQL 的 ORDER BY 會把 2.1.10 排在 2.1.9 前面, 所以在這裡排序.
    list: () =>
      (selectAll.all() as { value: string }[])
        .map((row) => JSON.parse(row.value) as ClassifiedRelease)
        .sort((a, b) => compareVersions(b.version, a.version)),
  };
}
