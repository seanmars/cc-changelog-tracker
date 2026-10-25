// 產生 docs/architecture.html: 把 Mermaid 原始碼和 Pele 都內嵌到單一 HTML, 離線也能閱讀.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { render } from 'pele';

const DIAGRAMS = ['architecture', 'state-flow'];
const OUTPUT = 'docs/architecture.html';

// 內嵌在 <script> 中的內容不能出現 </script, 否則瀏覽器會提早結束 script 區塊.
function escapeForScript(content: string): string {
  return content.replace(/<\/script/gi, '<\\/script');
}

const replacements: Record<string, string> = {};

for (const name of DIAGRAMS) {
  const source = readFileSync(`docs/src/${name}.mmd`, 'utf8').trim();
  if (/<\/script/i.test(source)) throw new Error(`${name}.mmd 不能包含 </script`);
  // 先在 Node 端 render 一次, 語法錯誤時在產生 HTML 之前就失敗.
  render(source);
  replacements[name] = source;
}

const require = createRequire(import.meta.url);
replacements.pele = escapeForScript(readFileSync(require.resolve('pele/global'), 'utf8'));

const template = readFileSync('docs/src/template.html', 'utf8');
// 用函式當 replacement, 避免內容中的 $& 之類字串被當成特殊符號.
const html = template.replace(/\{\{([\w-]+)\}\}/g, (match, key: string) => {
  const value = replacements[key];
  if (value === undefined) throw new Error(`template 中有未知的 placeholder: ${match}`);
  return value;
});

writeFileSync(OUTPUT, html, 'utf8');
console.log(`已產生 ${OUTPUT} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
