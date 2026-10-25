import { GoogleGenAI } from '@google/genai';
import type { ClassifiedRelease } from './categories.ts';

const INSTRUCTIONS = `把下方 JSON 的 summary 和 entries 翻譯成台灣正體中文.

規則:
- 使用台灣用語, 禁止使用中國用語. 例如: 檔案 (不是文件), 程式 (不是程序), 設定 (不是設置), 預設 (不是默認), 伺服器 (不是服務器), 資料 (不是數據).
- 技術詞彙, 產品名稱, 指令, 設定名稱, 反引號內的內容保留英文原文.
- 開頭的方括號標籤 (例如 [VSCode]) 保留原樣.
- 使用半形標點符號.
- entries 的數量和順序必須和輸入相同.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    entries: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'entries'],
};

export function createTranslator(apiKey: string, model: string) {
  const client = new GoogleGenAI({ apiKey });

  return async (release: ClassifiedRelease): Promise<ClassifiedRelease> => {
    const source = { summary: release.summary, entries: release.entries.map((e) => e.text) };
    const interaction = await client.interactions.create({
      model,
      input: `${INSTRUCTIONS}\n\n${JSON.stringify(source, null, 2)}`,
      response_format: { type: 'text', mime_type: 'application/json', schema: OUTPUT_SCHEMA },
    });

    const translated = parseOutput(interaction.output_text, release.entries.length);
    return {
      version: release.version,
      summary: translated.summary,
      entries: release.entries.map((entry, i) => ({ ...entry, text: translated.entries[i] })),
    };
  };
}

function parseOutput(text: string | undefined, expectedCount: number): { summary: string; entries: string[] } {
  if (!text) throw new Error('Gemini 沒有回傳翻譯內容');
  const value = JSON.parse(text) as { summary?: unknown; entries?: unknown };
  if (typeof value.summary !== 'string' || !Array.isArray(value.entries)) {
    throw new Error('Gemini 翻譯結果格式錯誤');
  }
  if (value.entries.length !== expectedCount) {
    throw new Error(`Gemini 翻譯數量不符: 預期 ${expectedCount}, 實際 ${value.entries.length}`);
  }
  return { summary: value.summary, entries: value.entries.map(String) };
}
