import { tmpdir } from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CATEGORIES, type Category, type ClassifiedRelease } from './categories.ts';
import type { Release } from './changelog.ts';
import type { ClaudeAuth, ClaudeAuthType } from './settings.ts';

const AUTH_ENV: Record<ClaudeAuthType, string> = {
  'oauth-token': 'CLAUDE_CODE_OAUTH_TOKEN',
  'api-key': 'ANTHROPIC_API_KEY',
};

const SYSTEM_PROMPT = `You classify entries of the Claude Code changelog.

Categories:
- added: a new feature, command, setting, tool, or platform support.
- improved: an existing feature works better, faster, or is easier to use.
- changed: an existing behavior or default is different, renamed, or deprecated, and it is not a fix or an improvement.
- fixed: a bug fix.
- removed: a feature or option is removed.
- other: anything that fits none of the above.

Judge each entry by its meaning, not only by its first word.
Also write a summary: 2 to 4 short English sentences about the changes that matter most to users.`;

// categories 用 entry 編號當 key, 每個編號都是 required. 用 array 時模型可能多給或少給一個,
// 後面的分類全部錯位. 改用 key 後, SDK 驗證 schema 失敗會讓模型重試, 數量一定正確.
function buildSchema(entryCount: number) {
  const keys = Array.from({ length: entryCount }, (_, i) => String(i + 1));
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      categories: {
        type: 'object',
        properties: Object.fromEntries(keys.map((key) => [key, { type: 'string', enum: [...CATEGORIES] }])),
        required: keys,
        additionalProperties: false,
      },
    },
    required: ['summary', 'categories'],
    additionalProperties: false,
  };
}

export function createClassifier(model: string, auth: ClaudeAuth) {
  const env = buildEnv(auth);
  return async (release: Release): Promise<ClassifiedRelease> => {
    const numbered = release.entries.map((entry, i) => `${i + 1}. ${entry}`).join('\n');
    const prompt = `Version ${release.version}\n\nEntries:\n${numbered}\n\nIn categories, give the category of every entry, keyed by its entry number (1 to ${release.entries.length}).`;

    let output: unknown;
    for await (const message of query({
      prompt,
      options: {
        model,
        systemPrompt: SYSTEM_PROMPT,
        outputFormat: { type: 'json_schema', schema: buildSchema(release.entries.length) },
        // 只需要分類, 關閉所有內建工具, 也不讀取使用者的 CLAUDE.md 和設定.
        tools: [],
        settingSources: [],
        permissionMode: 'dontAsk',
        persistSession: false,
        maxTurns: 5,
        cwd: tmpdir(),
        env,
      },
    })) {
      if (message.type === 'result') {
        if (message.subtype !== 'success' || message.structured_output === undefined) {
          throw new Error(`Claude 分類失敗: ${message.subtype}`);
        }
        output = message.structured_output;
      }
    }

    const { summary, categories } = parseOutput(output, release.entries.length);
    return {
      version: release.version,
      summary,
      entries: release.entries.map((text, i) => ({ text, category: categories[i] })),
    };
  };
}

// SDK 的 env 會整個取代子程序的環境變數. 移除原有的 Claude 認證, 只使用後台設定的 key.
function buildEnv(auth: ClaudeAuth): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const name of Object.values(AUTH_ENV)) delete env[name];
  env[AUTH_ENV[auth.type]] = auth.key;
  return env;
}

function parseOutput(output: unknown, entryCount: number): { summary: string; categories: Category[] } {
  const value = output as { summary?: unknown; categories?: Record<string, unknown> | null } | undefined;
  const map = value?.categories;
  if (typeof value?.summary !== 'string' || typeof map !== 'object' || map === null) {
    throw new Error('Claude 分類結果格式錯誤');
  }
  const categories = Array.from({ length: entryCount }, (_, i) => {
    const category = map[String(i + 1)];
    if (category === undefined) throw new Error(`Claude 分類結果缺少第 ${i + 1} 條`);
    return CATEGORIES.includes(category as Category) ? (category as Category) : 'other';
  });
  return { summary: value.summary, categories };
}
