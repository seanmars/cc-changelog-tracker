import { setTimeout as sleep } from 'node:timers/promises';
import { CATEGORIES, CATEGORY_LABELS, type ClassifiedRelease } from './categories.ts';

// Discord embed description 上限是 4096 字元, 保留一些餘裕.
export const MAX_DESCRIPTION = 4000;
const EMBED_COLOR = 0xd97757;
const MAX_ATTEMPTS = 3;

export interface DiscordMessage {
  embeds: { title: string; url: string; description: string; color: number }[];
}

export function buildMessages(release: ClassifiedRelease, linkUrl: string): DiscordMessage[] {
  const lines: string[] = [release.summary, ''];
  for (const category of CATEGORIES) {
    const texts = release.entries.filter((e) => e.category === category).map((e) => e.text);
    if (texts.length === 0) continue;
    lines.push(`**${CATEGORY_LABELS[category]} (${texts.length})**`);
    lines.push(...texts.map((t) => `- ${t}`));
    lines.push('');
  }

  const title = `Claude Code v${release.version}`;
  const chunks = chunkLines(lines, MAX_DESCRIPTION);
  return chunks.map((description, i) => ({
    embeds: [
      {
        title: chunks.length === 1 ? title : `${title} (${i + 1}/${chunks.length})`,
        url: linkUrl,
        description,
        color: EMBED_COLOR,
      },
    ],
  }));
}

// 超過 maxLength 的單行會先截斷, 每個 chunk 都不會超過上限.
function chunkLines(lines: string[], maxLength: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const rawLine of lines) {
    const line = truncate(rawLine, maxLength);
    const next = current === '' ? line : `${current}\n${line}`;
    if (next.length > maxLength && current !== '') {
      chunks.push(current.trimEnd());
      current = line;
    } else {
      current = next;
    }
  }
  if (current.trim() !== '') chunks.push(current.trimEnd());
  return chunks;
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export async function sendMessage(webhookUrl: string, message: DiscordMessage): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return;

    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await sleep(Math.ceil((body.retry_after ?? 1) * 1000));
      continue;
    }
    throw new Error(`Discord webhook 失敗: HTTP ${res.status} ${await res.text()}`);
  }
}
