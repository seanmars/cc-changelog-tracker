import type { DatabaseSync } from 'node:sqlite';

export interface State {
  lastVersion: string | null;
  etag: string | null;
}

export interface StateStore {
  load(): State;
  save(state: State): void;
}

// key 是欄位名稱, value 是欄位的值. 沒有資料時視為尚未初始化.
export function openStateStore(db: DatabaseSync): StateStore {
  db.exec('CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT) STRICT');

  const selectAll = db.prepare('SELECT key, value FROM state');
  // 一個 statement 同時寫入兩個 key, SQLite 保證不會只寫一半.
  const upsert = db.prepare(
    `INSERT INTO state (key, value) VALUES ('lastVersion', ?), ('etag', ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  );

  return {
    load: () => {
      const rows = selectAll.all() as { key: string; value: string | null }[];
      const values = new Map(rows.map((row) => [row.key, row.value]));
      return { lastVersion: values.get('lastVersion') ?? null, etag: values.get('etag') ?? null };
    },
    save: (state) => {
      upsert.run(state.lastVersion, state.etag);
    },
  };
}
