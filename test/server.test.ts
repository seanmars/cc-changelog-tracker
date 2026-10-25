import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { openLogStore } from '../src/logs.ts';
import { openReleaseStore } from '../src/releases.ts';
import { createAdminServer } from '../src/server.ts';
import { openSettingsStore } from '../src/settings.ts';
import { DEFAULT_TRANSLATION_PROMPT } from '../src/translator.ts';

const db = new DatabaseSync(':memory:');
const settings = openSettingsStore(db);
const logs = openLogStore(db);
const releases = openReleaseStore(db);
let wakeCount = 0;
let fetching = false;
const fetchCounts: number[] = [];
const notifiedVersions: string[] = [];
const retranslatedVersions: string[] = [];
const server = createAdminServer({
  settings,
  logs,
  releases,
  loadState: () => ({ lastVersion: '2.1.3', etag: null }),
  onSettingsSaved: () => {
    wakeCount++;
  },
  fetchRecent: (count) => {
    if (fetching) return false;
    fetching = true;
    fetchCounts.push(count);
    return true;
  },
  isFetching: () => fetching,
  notifyVersion: async (version) => {
    notifiedVersions.push(version);
  },
  retranslate: async (version) => {
    retranslatedVersions.push(version);
  },
});
let baseUrl = '';

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function put(body: string): Promise<Response> {
  return fetch(`${baseUrl}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('GET / 回傳後台頁面', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await res.text(), /cc-changelog-tracker 後台/);
});

test('設定未完成時狀態為暫停', async () => {
  const status = await (await fetch(`${baseUrl}/api/status`)).json();
  assert.equal(status.ready, false);
  assert.equal(status.lastVersion, '2.1.3');
  assert.ok(status.problems.length > 0);
});

test('PUT 設定後保存並喚醒 scheduler', async () => {
  const res = await put(
    JSON.stringify({
      discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
      geminiApiKey: 'gemini-key',
      claudeKey: 'claude-key',
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ready: true, problems: [], lastVersion: '2.1.3', fetching: false });
  assert.equal(wakeCount, 1);
  assert.equal(settings.load().geminiApiKey, 'gemini-key');
});

test('PUT 錯誤的 JSON 回傳 400', async () => {
  assert.equal((await put('{')).status, 400);
  assert.equal((await put('[]')).status, 400);
});

test('GET /api/logs 回傳最新的 log', async () => {
  logs.add('info', 'CHANGELOG 沒有變化');
  const entries = await (await fetch(`${baseUrl}/api/logs?limit=1`)).json();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'CHANGELOG 沒有變化');
});

test('不是 application/json 的寫入請求回傳 415', async () => {
  const res = await fetch(`${baseUrl}/api/releases/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ version: '2.1.3' }),
  });
  assert.equal(res.status, 415);
  assert.deepEqual(notifiedVersions, []);
});

test('GET /api/releases 回傳 DB 中的版本', async () => {
  releases.put({ version: '2.1.3', summary: '摘要', entries: [] }, { version: '2.1.3', summary: 'Summary', entries: [] });
  const list = await (await fetch(`${baseUrl}/api/releases`)).json();
  assert.deepEqual(
    list.map((r: { version: string }) => r.version),
    ['2.1.3'],
  );
});

test('POST /api/releases/fetch 檢查 count, 抓取中時回傳 409', async () => {
  assert.equal((await post('/api/releases/fetch', { count: 0 })).status, 400);
  assert.equal((await post('/api/releases/fetch', { count: '5' })).status, 400);

  const res = await post('/api/releases/fetch', { count: 5 });
  assert.equal(res.status, 202);
  assert.equal((await res.json()).fetching, true);
  assert.equal((await post('/api/releases/fetch', { count: 3 })).status, 409);
  assert.deepEqual(fetchCounts, [5]);
  fetching = false;
});

test('POST /api/releases/notify 送出指定版本', async () => {
  assert.equal((await post('/api/releases/notify', {})).status, 400);
  const res = await post('/api/releases/notify', { version: '2.1.3' });
  assert.equal(res.status, 200);
  assert.deepEqual(notifiedVersions, ['2.1.3']);
});

test('POST /api/releases/retranslate 重新翻譯指定版本', async () => {
  assert.equal((await post('/api/releases/retranslate', { version: '' })).status, 400);
  const res = await post('/api/releases/retranslate', { version: '2.1.3' });
  assert.equal(res.status, 200);
  assert.deepEqual(retranslatedVersions, ['2.1.3']);
});

test('GET /api/settings/defaults 回傳預設設定', async () => {
  const defaults = await (await fetch(`${baseUrl}/api/settings/defaults`)).json();
  assert.equal(defaults.translationPrompt, DEFAULT_TRANSLATION_PROMPT);
});

test('未知路徑回傳 404', async () => {
  assert.equal((await fetch(`${baseUrl}/nope`)).status, 404);
});
