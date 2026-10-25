import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openStateStore } from '../src/state.ts';

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
