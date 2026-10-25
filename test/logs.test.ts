import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { openLogStore } from '../src/logs.ts';

test('由新到舊回傳 log', () => {
  const logs = openLogStore(new DatabaseSync(':memory:'));
  logs.add('info', 'first');
  logs.add('error', 'second');
  assert.deepEqual(
    logs.recent(10).map((e) => [e.level, e.message]),
    [
      ['error', 'second'],
      ['info', 'first'],
    ],
  );
});

test('超過上限時刪除最舊的 log', () => {
  const logs = openLogStore(new DatabaseSync(':memory:'), 3);
  for (const message of ['1', '2', '3', '4', '5']) logs.add('info', message);
  assert.deepEqual(
    logs.recent(10).map((e) => e.message),
    ['5', '4', '3'],
  );
});
