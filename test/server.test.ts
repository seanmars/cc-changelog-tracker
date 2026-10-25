import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { openLogStore } from '../src/logs.ts';
import { createAdminServer } from '../src/server.ts';
import { openSettingsStore } from '../src/settings.ts';

const db = new DatabaseSync(':memory:');
const settings = openSettingsStore(db);
const logs = openLogStore(db);
let wakeCount = 0;
const server = createAdminServer({
  settings,
  logs,
  loadState: () => ({ lastVersion: '2.1.3', etag: null }),
  onSettingsSaved: () => {
    wakeCount++;
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
  assert.deepEqual(await res.json(), { ready: true, problems: [], lastVersion: '2.1.3' });
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

test('未知路徑回傳 404', async () => {
  assert.equal((await fetch(`${baseUrl}/nope`)).status, 404);
});
