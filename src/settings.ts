import type { DatabaseSync } from 'node:sqlite';

const CLAUDE_AUTH_TYPES =['oauth-token', 'api-key'] as const;

export type ClaudeAuthType = (typeof CLAUDE_AUTH_TYPES)[number];

// 後台的所有設定都以字串保存, 由 parseSettings 驗證並轉成 TrackerConfig.
export interface Settings {
  discordWebhookUrl: string;
  geminiApiKey: string;
  claudeAuthType: string;
  claudeKey: string;
  checkIntervalMinutes: string;
  geminiModel: string;
  claudeModel: string;
  changelogUrl: string;
  linkUrl: string;
}

type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  discordWebhookUrl: '',
  geminiApiKey: '',
  claudeAuthType: 'oauth-token',
  claudeKey: '',
  checkIntervalMinutes: '10',
  geminiModel: 'gemini-3.5-flash-lite',
  claudeModel: 'claude-sonnet-5-5',
  changelogUrl: 'https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md',
  linkUrl: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md',
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

const SETTING_LABELS:Record<SettingKey, string> = {
  discordWebhookUrl: 'Discord webhook URL',
  geminiApiKey: 'Gemini API key',
  claudeAuthType: 'Claude 認證方式',
  claudeKey: 'Claude key',
  checkIntervalMinutes: '檢查間隔',
  geminiModel: 'Gemini model',
  claudeModel: 'Claude model',
  changelogUrl: 'CHANGELOG 下載 URL',
  linkUrl: '通知中的 CHANGELOG 連結',
};

const URL_KEYS: SettingKey[] = ['discordWebhookUrl', 'changelogUrl', 'linkUrl'];

export interface ClaudeAuth {
  type: ClaudeAuthType;
  key: string;
}

export interface TrackerConfig {
  discordWebhookUrl: string;
  geminiApiKey: string;
  claudeAuth: ClaudeAuth;
  checkIntervalMinutes: number;
  geminiModel: string;
  claudeModel: string;
  changelogUrl: string;
  linkUrl: string;
}

export type ParseResult = { ok: true; config: TrackerConfig } | { ok: false; problems: string[] };

export function parseSettings(settings: Settings): ParseResult {
  const problems: string[] = [];
  for (const key of SETTING_KEYS) {
    const value = settings[key];
    if (value === '') problems.push(`${SETTING_LABELS[key]} 未設定`);
    else if (URL_KEYS.includes(key) && !URL.canParse(value)) problems.push(`${SETTING_LABELS[key]} 不是有效的 URL`);
  }

  const interval = Number(settings.checkIntervalMinutes);
  if (settings.checkIntervalMinutes !== '' && !(Number.isFinite(interval) && interval > 0)) {
    problems.push(`${SETTING_LABELS.checkIntervalMinutes} 必須是正數`);
  }
  if (!(CLAUDE_AUTH_TYPES as readonly string[]).includes(settings.claudeAuthType)) {
    problems.push(`${SETTING_LABELS.claudeAuthType} 必須是 ${CLAUDE_AUTH_TYPES.join(' 或 ')}`);
  }
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    config: {
      discordWebhookUrl: settings.discordWebhookUrl,
      geminiApiKey: settings.geminiApiKey,
      claudeAuth: { type: settings.claudeAuthType as ClaudeAuthType, key: settings.claudeKey },
      checkIntervalMinutes: interval,
      geminiModel: settings.geminiModel,
      claudeModel: settings.claudeModel,
      changelogUrl: settings.changelogUrl,
      linkUrl: settings.linkUrl,
    },
  };
}

// 只取已知的字串欄位並去掉前後空白, 沒有送來的欄位沿用目前的設定.
export function mergeSettings(current: Settings, input: Record<string, unknown>): Settings {
  const merged = { ...current };
  for (const key of SETTING_KEYS) {
    const value = input[key];
    if (typeof value === 'string') merged[key] = value.trim();
  }
  return merged;
}

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
}

// key 是設定名稱, value 是設定值. DB 中沒有的設定使用預設值.
export function openSettingsStore(db: DatabaseSync): SettingsStore {
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');

  const selectAll = db.prepare('SELECT key, value FROM settings');
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );

  return {
    load: () => {
      const settings = { ...DEFAULT_SETTINGS };
      for (const row of selectAll.all() as { key: string; value: string }[]) {
        if (Object.hasOwn(DEFAULT_SETTINGS, row.key)) settings[row.key as SettingKey] = row.value;
      }
      return settings;
    },
    save: (settings) => {
      // 所有 key 放在同一個 transaction, 不會只存一半.
      db.exec('BEGIN');
      try {
        for (const key of SETTING_KEYS) upsert.run(key, settings[key]);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
