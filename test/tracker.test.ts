import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FetchResult } from '../src/fetcher.ts';
import type { State } from '../src/state.ts';
import { checkOnce, type TrackerDeps } from '../src/tracker.ts';

const CHANGELOG = `# Changelog

## 2.1.3

- Fixed C

## 2.1.2

- Added B

## 2.1.1

- Added A
`;

function createDeps(initial: State, fetchResult: FetchResult, failOn?: string) {
  const saved: State[] = [];
  const notified: string[] = [];
  let state = initial;
  const deps: TrackerDeps = {
    fetchChangelog: async () => fetchResult,
    loadState: async () => state,
    saveState: async (s) => {
      state = s;
      saved.push(s);
    },
    classify: async (r) => ({
      version: r.version,
      summary: '',
      entries: r.entries.map((text) => ({ text, category: 'other' })),
    }),
    translate: async (r) => r,
    notify: async (r) => {
      if (r.version === failOn) throw new Error('notify failed');
      notified.push(r.version);
    },
    log: () => {},
  };
  return { deps, saved, notified };
}

const OK: FetchResult = { status: 'ok', body: CHANGELOG, etag: 'new-etag' };

test('第一次執行只記錄最新版本, 不送通知', async () => {
  const { deps, saved, notified } = createDeps({ lastVersion: null, etag: null }, OK);
  await checkOnce(deps);
  assert.deepEqual(notified, []);
  assert.deepEqual(saved.at(-1), { lastVersion: '2.1.3', etag: 'new-etag' });
});

test('304 時不做任何事', async () => {
  const { deps, saved, notified } = createDeps({ lastVersion: '2.1.1', etag: 'old' }, { status: 'not-modified' });
  await checkOnce(deps);
  assert.deepEqual(notified, []);
  assert.deepEqual(saved, []);
});

test('依序通知新版本, 最後更新 ETag', async () => {
  const { deps, saved, notified } = createDeps({ lastVersion: '2.1.1', etag: 'old' }, OK);
  await checkOnce(deps);
  assert.deepEqual(notified, ['2.1.2', '2.1.3']);
  assert.deepEqual(saved.at(-1), { lastVersion: '2.1.3', etag: 'new-etag' });
});

test('中途失敗時保留進度和舊 ETag, 下次從失敗的版本繼續', async () => {
  const { deps, saved, notified } = createDeps({ lastVersion: '2.1.1', etag: 'old' }, OK, '2.1.3');
  await assert.rejects(checkOnce(deps), /notify failed/);
  assert.deepEqual(notified, ['2.1.2']);
  assert.deepEqual(saved.at(-1), { lastVersion: '2.1.2', etag: 'old' });
});

test('找不到任何版本時拋出錯誤', async () => {
  const { deps } = createDeps({ lastVersion: '2.1.1', etag: 'old' }, { status: 'ok', body: '# Empty', etag: 'x' });
  await assert.rejects(checkOnce(deps), /找不到任何版本/);
});
