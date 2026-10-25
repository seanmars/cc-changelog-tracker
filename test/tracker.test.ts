import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClassifiedRelease } from '../src/categories.ts';
import type { FetchResult } from '../src/fetcher.ts';
import type { State } from '../src/state.ts';
import { checkOnce, fetchRecent, notifyLatest, notifyVersion, retranslate, type TrackerDeps } from '../src/tracker.ts';

const CHANGELOG = `# Changelog

## 2.1.3

- Fixed C

## 2.1.2

- Added B

## 2.1.1

- Added A
`;

function createDeps(
  initial: State,
  fetchResult: FetchResult,
  failOn?: string,
  existing: ClassifiedRelease[] = [],
  existingSources: ClassifiedRelease[] = [],
) {
  const saved: State[] = [];
  const stored: string[] = [];
  const notified: string[] = [];
  const classified: string[] = [];
  const releases = new Map(existing.map((r) => [r.version, r]));
  const sources = new Map(existingSources.map((r) => [r.version, r]));
  let state = initial;
  const deps: TrackerDeps = {
    fetchChangelog: async () => fetchResult,
    loadState: async () => state,
    saveState: async (s) => {
      state = s;
      saved.push(s);
    },
    classify: async (r) => {
      classified.push(r.version);
      return { version: r.version, summary: `Summary ${r.version}`, entries: r.entries.map((text) => ({ text, category: 'other' })) };
    },
    translate: async (r) => ({ ...r, summary: `${r.summary} (譯)` }),
    find: async (version) => releases.get(version),
    findSource: async (version) => sources.get(version),
    save: async (r, source) => {
      releases.set(r.version, r);
      sources.set(source.version, source);
      stored.push(r.version);
    },
    notify: async (r) => {
      if (r.version === failOn) throw new Error('notify failed');
      notified.push(r.version);
    },
    log: () => {},
  };
  return { deps, saved, stored, notified, classified, releases, sources };
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

test('依序儲存並通知新版本, 最後更新 ETag', async () => {
  const { deps, saved, stored, notified } = createDeps({ lastVersion: '2.1.1', etag: 'old' }, OK);
  await checkOnce(deps);
  assert.deepEqual(stored, ['2.1.2', '2.1.3']);
  assert.deepEqual(notified, ['2.1.2', '2.1.3']);
  assert.deepEqual(saved.at(-1), { lastVersion: '2.1.3', etag: 'new-etag' });
});

test('中途失敗時保留進度和舊 ETag, 下次從失敗的版本繼續', async () => {
  const { deps, saved, stored, notified } = createDeps({ lastVersion: '2.1.1', etag: 'old' }, OK, '2.1.3');
  await assert.rejects(checkOnce(deps), /notify failed/);
  // 通知失敗前已經存好, 下次重跑會覆寫同一個 key.
  assert.deepEqual(stored, ['2.1.2', '2.1.3']);
  assert.deepEqual(notified, ['2.1.2']);
  assert.deepEqual(saved.at(-1), { lastVersion: '2.1.2', etag: 'old' });
});

test('找不到任何版本時拋出錯誤', async () => {
  const { deps } = createDeps({ lastVersion: '2.1.1', etag: 'old' }, { status: 'ok', body: '# Empty', etag: 'x' });
  await assert.rejects(checkOnce(deps), /找不到任何版本/);
});

test('notifyLatest 只通知最新版本, 不修改 state', async () => {
  const { deps, saved, stored, notified } = createDeps({ lastVersion: '2.1.3', etag: 'old' }, OK);
  await notifyLatest(deps);
  assert.deepEqual(stored, ['2.1.3']);
  assert.deepEqual(notified, ['2.1.3']);
  assert.deepEqual(saved, []);
});

const STORED_213: ClassifiedRelease = { version: '2.1.3', summary: '已翻譯', entries: [] };

test('fetchRecent 只翻譯 DB 沒有的版本, 不通知也不修改 state', async () => {
  const { deps, saved, stored, notified } = createDeps({ lastVersion: '2.1.3', etag: 'old' }, OK, undefined, [STORED_213]);
  await fetchRecent(deps, 2);
  assert.deepEqual(stored, ['2.1.2']);
  assert.deepEqual(notified, []);
  assert.deepEqual(saved, []);
});

test('notifyVersion 優先使用 DB 中的翻譯結果', async () => {
  const { deps, stored, notified } = createDeps({ lastVersion: '2.1.3', etag: 'old' }, OK, undefined, [STORED_213]);
  await notifyVersion(deps, '2.1.3');
  assert.deepEqual(stored, []);
  assert.deepEqual(notified, ['2.1.3']);
});

test('notifyVersion 在 DB 沒有時先翻譯, 找不到版本時拋出錯誤', async () => {
  const { deps, stored, notified } = createDeps({ lastVersion: '2.1.3', etag: 'old' }, OK);
  await notifyVersion(deps, '2.1.1');
  assert.deepEqual(stored, ['2.1.1']);
  assert.deepEqual(notified, ['2.1.1']);
  await assert.rejects(notifyVersion(deps, '9.9.9'), /找不到版本 9\.9\.9/);
});

test('翻譯時一併保存分類後的原文', async () => {
  const { deps, sources, releases } = createDeps({ lastVersion: '2.1.3', etag: 'old' }, OK);
  await fetchRecent(deps, 1);
  assert.equal(sources.get('2.1.3')?.summary, 'Summary 2.1.3');
  assert.equal(releases.get('2.1.3')?.summary, 'Summary 2.1.3 (譯)');
});

test('retranslate 有原文時只重新翻譯, 不重新分類也不通知', async () => {
  const source: ClassifiedRelease = { version: '2.1.3', summary: 'English', entries: [{ text: 'Fixed C', category: 'fixed' }] };
  const { deps, classified, notified, releases } = createDeps(
    { lastVersion: '2.1.3', etag: 'old' },
    OK,
    undefined,
    [STORED_213],
    [source],
  );
  await retranslate(deps, '2.1.3');
  assert.deepEqual(classified, []);
  assert.deepEqual(notified, []);
  assert.equal(releases.get('2.1.3')?.summary, 'English (譯)');
  assert.deepEqual(releases.get('2.1.3')?.entries, source.entries);
});

test('retranslate 沒有原文時重新下載並分類', async () => {
  const { deps, classified, sources } = createDeps({ lastVersion: '2.1.3', etag: 'old' }, OK, undefined, [STORED_213]);
  await retranslate(deps, '2.1.3');
  assert.deepEqual(classified, ['2.1.3']);
  assert.equal(sources.get('2.1.3')?.summary, 'Summary 2.1.3');
});
