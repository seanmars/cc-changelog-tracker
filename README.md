# cc-changelog-tracker

定時偵測 [Claude Code CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) 的新版本. 用 Claude 分類條目並產生摘要, 用 Gemini 翻譯成台灣正體中文, 再送到 Discord.

## 需求

- Node.js 24 以上
- Discord webhook URL, Gemini API key
- Claude 認證: 設定 `ANTHROPIC_API_KEY`, 或使用本機 Claude Code 的登入資料

## 使用方式

1. 執行 `pnpm install`.
2. 複製 `.env.example` 為 `.env`, 填入設定.
3. 執行下列指令之一:

| 指令 | 說明 |
|---|---|
| `pnpm start` | 常駐執行, 每 `CHECK_INTERVAL_MINUTES` 分鐘檢查一次 |
| `pnpm run check` | 只檢查一次 |
| `pnpm run notify-latest` | 測試用, 直接通知最新版本, 不更新 state |

第一次執行只記錄目前的最新版本, 不送通知.

資料保存在 SQLite `data/tracker.db`, 兩個表都是 kv 格式:

| 表 | key | value |
|---|---|---|
| `state` | `lastVersion`, `etag` | 進度 |
| `releases` | 版本號 | 翻譯後的 release JSON |

啟動時若找到舊版的 `data/state.json`, 而且 DB 還沒有進度, 會自動匯入, 並把原檔改名為 `state.json.imported`.

## 部署到樹莓派 (Docker)

需要 Pi 4 或 Pi 5, 並安裝 64-bit OS. Claude Code 沒有 32-bit ARM 版本.

1. 在已登入 Claude Code 的電腦上執行 `claude setup-token`, 把產生的 token 填入 `.env` 的 `CLAUDE_CODE_OAUTH_TOKEN`.
2. 把專案 (含 `.env`, 不含 `node_modules`) 複製到樹莓派.
3. 在樹莓派的專案目錄執行 `docker compose up -d --build`.
4. 執行 `docker compose logs -f`, 確認出現「初始化完成」.

進度保存在 Docker volume `tracker-data`. 只要不刪除這個 volume, 重新 build 也不會重複通知.

## 開發

```sh
pnpm run typecheck
pnpm test
pnpm run docs   # 由 docs/src/*.mmd 產生 docs/architecture.html
```

架構圖和狀態流程圖在 `docs/architecture.html`. 這個檔案已內嵌所有資源, 離線也能開啟.
