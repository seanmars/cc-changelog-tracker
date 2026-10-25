import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClassifiedRelease } from '../src/categories.ts';
import { MAX_DESCRIPTION, buildMessages } from '../src/discord.ts';

const LINK = 'https://example.com/changelog';

test('buildMessages 依分類分組, 順序固定', () => {
  const release: ClassifiedRelease = {
    version: '2.1.10',
    summary: '摘要',
    entries: [
      { text: '修正 A', category: 'fixed' },
      { text: '新增 B', category: 'added' },
      { text: '修正 C', category: 'fixed' },
    ],
  };
  const messages = buildMessages(release, LINK);

  assert.equal(messages.length, 1);
  const embed = messages[0].embeds[0];
  assert.equal(embed.title, 'Claude Code v2.1.10');
  assert.equal(embed.url, LINK);
  assert.equal(embed.description, '摘要\n\n**✨ 新增 (1)**\n- 新增 B\n\n**🐛 修正 (2)**\n- 修正 A\n- 修正 C');
});

test('buildMessages 內容過長時分成多則訊息', () => {
  const release: ClassifiedRelease = {
    version: '2.1.10',
    summary: '摘要',
    entries: Array.from({ length: 100 }, (_, i) => ({ text: `${i} ${'x'.repeat(100)}`, category: 'fixed' as const })),
  };
  const messages = buildMessages(release, LINK);

  assert.ok(messages.length > 1);
  for (const [i, message] of messages.entries()) {
    assert.ok(message.embeds[0].description.length <= MAX_DESCRIPTION);
    assert.equal(message.embeds[0].title, `Claude Code v2.1.10 (${i + 1}/${messages.length})`);
  }
  const allText = messages.map((m) => m.embeds[0].description).join('\n');
  assert.ok(allText.includes('- 0 x') && allText.includes('- 99 x'));
});

test('buildMessages 截斷超過上限的單一條目', () => {
  const release: ClassifiedRelease = {
    version: '2.1.10',
    summary: '摘要',
    entries: [{ text: 'y'.repeat(MAX_DESCRIPTION * 2), category: 'other' }],
  };
  for (const message of buildMessages(release, LINK)) {
    assert.ok(message.embeds[0].description.length <= MAX_DESCRIPTION);
  }
});
