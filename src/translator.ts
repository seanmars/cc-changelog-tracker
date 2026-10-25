import { GoogleGenAI } from '@google/genai';
import type { ClassifiedRelease } from './categories.ts';

// 輸入太長時, Gemini 常把原文原封不動抄回來, 所以每次只翻譯 CHUNK_SIZE 段.
const CHUNK_SIZE = 20;
const MAX_ATTEMPTS = 2;

// 後台可以修改翻譯 prompt, 這是預設值, 後台的「還原預設」會還原成這段.
export const DEFAULT_TRANSLATION_PROMPT = `把內容翻譯成台灣正體中文. 內容是 Claude Code CHANGELOG 的摘要和條目.

規則:
- 使用台灣正體中文 (繁體字), 禁止使用簡體字. 例如: 設定 (不是设定), 檔案 (不是档案), 執行 (不是执行).
- 使用台灣用語, 禁止使用中國用語. 例如: 檔案 (不是文件), 程式 (不是程序), 設定 (不是設置), 預設 (不是默認), 伺服器 (不是服務器), 資料 (不是數據).
- 技術詞彙, 產品名稱, 指令, 設定名稱, 反引號內的內容保留英文原文.
- 開頭的方括號標籤 (例如 [VSCode]) 保留原樣.
- 使用半形標點符號.`;

// 格式規則和分段, schema 綁在一起, 所以固定在程式中, 不開放後台修改.
const FORMAT_RULES = `輸入是下方的 JSON object. 翻譯每個 key 的內容. key 保持不變, 輸出必須包含輸入的每一個 key, 不能合併或拆開內容.`;

// 用編號當 key, 理由和 classifier 相同: 用 array 時數量錯一個, 後面的翻譯全部錯位.
function buildSchema(count: number) {
  const keys = Array.from({ length: count }, (_, i) => String(i + 1));
  return {
    type: 'object',
    properties: Object.fromEntries(keys.map((key) => [key, { type: 'string' }])),
    required: keys,
  };
}

export function createTranslator(apiKey: string, model: string, prompt: string) {
  const client = new GoogleGenAI({ apiKey });

  // 照抄的結果符合 schema, 所以要另外檢查. 只重送沒翻譯的那一段.
  async function translateChunk(texts: string[], hasSummary: boolean): Promise<string[]> {
    const source = Object.fromEntries(texts.map((text, i) => [String(i + 1), text]));
    const input = `${prompt}\n\n${FORMAT_RULES}\n\n${JSON.stringify(source, null, 2)}`;
    for (let attempt = 1; ; attempt++) {
      const interaction = await client.interactions.create({
        model,
        input,
        response_format: { type: 'text', mime_type: 'application/json', schema: buildSchema(texts.length) },
      });
      const translated = parseOutput(interaction.output_text, texts.length);
      if (isTranslated(texts, translated, hasSummary)) return translated;
      if (attempt === MAX_ATTEMPTS) throw new Error(`Gemini 試了 ${MAX_ATTEMPTS} 次都回傳未翻譯的原文`);
    }
  }

  return async (release: ClassifiedRelease): Promise<ClassifiedRelease> => {
    // summary 放在第一段的開頭, 和條目一起翻譯.
    const texts = [release.summary, ...release.entries.map((e) => e.text)];
    const chunks: string[][] = [];
    for (let i = 0; i < texts.length; i += CHUNK_SIZE) chunks.push(texts.slice(i, i + CHUNK_SIZE));
    const translated = (await Promise.all(chunks.map((chunk, i) => translateChunk(chunk, i === 0)))).flat();

    return {
      version: release.version,
      summary: translated[0],
      entries: release.entries.map((entry, i) => ({ ...entry, text: translated[i + 1] })),
    };
  };
}

// summary 是 Claude 寫的英文, 和原文相同就一定沒翻譯.
// 只由程式碼組成的條目翻譯後可能和原文相同, 所以超過一半相同才算沒翻譯, 只有 1 段時不檢查.
function isTranslated(source: string[], translated: string[], hasSummary: boolean): boolean {
  if (hasSummary && translated[0] === source[0]) return false;
  if (source.length <= 1) return true;
  const unchanged = translated.filter((text, i) => text === source[i]).length;
  return unchanged <= source.length / 2;
}

function parseOutput(text: string | undefined, count: number): string[] {
  if (!text) throw new Error('Gemini 沒有回傳翻譯內容');
  const value = JSON.parse(text) as Record<string, unknown> | null;
  if (typeof value !== 'object' || value === null) throw new Error('Gemini 翻譯結果格式錯誤');
  return Array.from({ length: count }, (_, i) => {
    const translated = value[String(i + 1)];
    if (typeof translated !== 'string') throw new Error(`Gemini 翻譯結果缺少 key ${i + 1}`);
    return translated;
  });
}
