import { existsSync } from 'node:fs';

export interface Config {
  changelogUrl: string;
  linkUrl: string;
  checkIntervalMinutes: number;
  statePath: string;
  dbPath: string;
  discordWebhookUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  claudeModel: string;
}

export function loadConfig(): Config {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const checkIntervalMinutes = Number(process.env.CHECK_INTERVAL_MINUTES ?? '10');
  if (!Number.isFinite(checkIntervalMinutes) || checkIntervalMinutes <= 0) {
    throw new Error('CHECK_INTERVAL_MINUTES 必須是正數');
  }

  return {
    changelogUrl:
      process.env.CHANGELOG_URL ?? 'https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md',
    linkUrl: process.env.LINK_URL ?? 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
    checkIntervalMinutes,
    statePath: process.env.STATE_PATH ?? 'data/state.json',
    dbPath: process.env.DB_PATH ?? 'data/tracker.db',
    discordWebhookUrl: required('DISCORD_WEBHOOK_URL'),
    geminiApiKey: required('GEMINI_API_KEY'),
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite',
    claudeModel: process.env.CLAUDE_MODEL ?? 'claude-sonnet-5-5',
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`缺少環境變數 ${name}`);
  return value;
}
