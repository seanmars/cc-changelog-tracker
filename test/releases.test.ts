import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { ClassifiedRelease } from '../src/categories.ts';
import { openReleaseStore } from '../src/releases.ts';

const RELEASE: ClassifiedRelease = {
  version: '2.1.3',
  summary: '摘要',
  entries: [{ text: '修正 C', category: 'fixed' }],
};

test('用版本號存取 release JSON', () => {
  const store = openReleaseStore(new DatabaseSync(':memory:'));
  store.put(RELEASE);
  assert.deepEqual(store.get('2.1.3'), RELEASE);
  assert.equal(store.get('9.9.9'), undefined);
});

test('同一版本再存一次時覆寫', () => {
  const store = openReleaseStore(new DatabaseSync(':memory:'));
  store.put(RELEASE);
  store.put({ ...RELEASE, summary: '新摘要' });
  assert.equal(store.get('2.1.3')?.summary, '新摘要');
});
