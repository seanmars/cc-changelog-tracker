import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createScheduler } from '../src/scheduler.ts';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../src/settings.ts';

const COMPLETE: Settings = {
  ...DEFAULT_SETTINGS,
  discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
  geminiApiKey: 'gemini-key',
  claudeKey: 'claude-key',
};

test('設定未完成時不檢查, 存檔喚醒後開始檢查', async () => {
  let settings = DEFAULT_SETTINGS;
  let checks = 0;
  const controller = new AbortController();
  const scheduler = createScheduler({
    loadConfig: () => parseSettings(settings),
    check: async () => {
      checks++;
    },
    log: () => {},
  });

  const running = scheduler.run(controller.signal);
  await sleep(20);
  assert.equal(checks, 0);

  settings = COMPLETE;
  scheduler.wake();
  await sleep(20);
  assert.equal(checks, 1);

  controller.abort();
  await running;
});

test('檢查失敗時記錄錯誤, 不中斷迴圈', async () => {
  const errors: string[] = [];
  const controller = new AbortController();
  const scheduler = createScheduler({
    loadConfig: () => parseSettings(COMPLETE),
    check: async () => {
      throw new Error('boom');
    },
    log: (level, message) => {
      if (level === 'error') errors.push(message);
    },
  });

  const running = scheduler.run(controller.signal);
  await sleep(20);
  scheduler.wake();
  await sleep(20);
  controller.abort();
  await running;
  assert.deepEqual(errors, ['檢查失敗, 下次重試: boom', '檢查失敗, 下次重試: boom']);
});
