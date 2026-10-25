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

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    categories: { type: 'array', items: { type: 'string', enum: [...CATEGORIES] } },
  },
  required: ['summary', 'categories'],
  additionalProperties: false,
};

export function createClassifier(model: string, auth: ClaudeAuth) {
  const env = buildEnv(auth);
  return async (release: Release): Promise<ClassifiedRelease> => {
    const numbered = release.entries.map((entry, i) => `${i + 1}. ${entry}`).join('\n');
    const prompt = `Version ${release.version}\n\nEntries:\n${numbered}\n\nReturn exactly ${release.entries.length} categories, one per entry, in the same order.`;

    let output: unknown;
    for await (const message of query({
      prompt,
      options: {
        model,
        systemPrompt: SYSTEM_PROMPT,
        outputFormat: { type: 'json_schema', schema: OUTPUT_SCHEMA },
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

function parseOutput(output: unknown, expectedCount: number): { summary: string; categories: Category[] } {
  const value = output as { summary?: unknown; categories?: unknown } | undefined;
  if (typeof value?.summary !== 'string' || !Array.isArray(value.categories)) {
    throw new Error('Claude 分類結果格式錯誤');
  }
  if (value.categories.length !== expectedCount) {
    throw new Error(`Claude 分類數量不符: 預期 ${expectedCount}, 實際 ${value.categories.length}`);
  }
  const categories = value.categories.map((c) => (CATEGORIES.includes(c) ? (c as Category) : 'other'));
  return { summary: value.summary, categories };
}
