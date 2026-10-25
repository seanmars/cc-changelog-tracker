import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, mergeSettings, openSettingsStore, parseSettings, type Settings } from '../src/settings.ts';

const COMPLETE: Settings = {
  ...DEFAULT_SETTINGS,
  discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
  geminiApiKey: 'gemini-key',
  claudeKey: 'claude-key',
};

test('預設設定缺少必填欄位', () => {
  const result = parseSettings(DEFAULT_SETTINGS);
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.problems, ['Discord webhook URL 未設定', 'Gemini API key 未設定', 'Claude key 未設定']);
});

test('設定完整時轉成 TrackerConfig', () => {
  const result = parseSettings(COMPLETE);
  assert.ok(result.ok);
  assert.equal(result.config.checkIntervalMinutes, 10);
  assert.deepEqual(result.config.claudeAuth, { type: 'oauth-token', key: 'claude-key' });
});

test('檢查 URL, 檢查間隔和 Claude 認證方式', () => {
  const result = parseSettings({ ...COMPLETE, discordWebhookUrl: 'not a url', checkIntervalMinutes: '-1', claudeAuthType: 'x' });
  assert.equal(result.ok, false);
  assert.deepEqual(!result.ok && result.problems, [
    'Discord webhook URL 不是有效的 URL',
    '檢查間隔 必須是正數',
    'Claude 認證方式 必須是 oauth-token 或 api-key',
  ]);
});

test('merge 只取已知的字串欄位並去掉空白', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { geminiApiKey: '  key  ', claudeKey: 123, unknown: 'x' });
  assert.equal(merged.geminiApiKey, 'key');
  assert.equal(merged.claudeKey, '');
  assert.equal('unknown' in merged, false);
});

test('沒有資料時回傳預設值, 保存後可以讀回', () => {
  const store = openSettingsStore(new DatabaseSync(':memory:'));
  assert.deepEqual(store.load(), DEFAULT_SETTINGS);
  store.save(COMPLETE);
  assert.deepEqual(store.load(), COMPLETE);
});
