import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { importLegacyState, openStateStore } from '../src/state.ts';

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-state-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('沒有資料時回傳未初始化的 state', () => {
  const store = openStateStore(new DatabaseSync(':memory:'));
  assert.deepEqual(store.load(), { lastVersion: null, etag: null });
});

test('保存後可以讀回, 再次保存時覆寫', () => {
  const store = openStateStore(new DatabaseSync(':memory:'));
  store.save({ lastVersion: '2.1.2', etag: 'old' });
  store.save({ lastVersion: '2.1.3', etag: null });
  assert.deepEqual(store.load(), { lastVersion: '2.1.3', etag: null });
});

test('匯入舊的 state.json 後改名, 不會再匯入', () => {
  withTempDir((dir) => {
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify({ lastVersion: '2.1.1', etag: 'legacy' }));
    const store = openStateStore(new DatabaseSync(':memory:'));

    assert.equal(importLegacyState(store, path), true);
    assert.deepEqual(store.load(), { lastVersion: '2.1.1', etag: 'legacy' });
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(`${path}.imported`), true);
    assert.equal(importLegacyState(store, path), false);
  });
});

test('DB 已有進度時不匯入, 也不動舊檔', () => {
  withTempDir((dir) => {
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify({ lastVersion: '2.1.1', etag: 'legacy' }));
    const store = openStateStore(new DatabaseSync(':memory:'));
    store.save({ lastVersion: '2.1.3', etag: 'current' });

    assert.equal(importLegacyState(store, path), false);
    assert.deepEqual(store.load(), { lastVersion: '2.1.3', etag: 'current' });
    assert.equal(existsSync(path), true);
  });
});
