# cc-changelog-tracker

定時偵測 [Claude Code CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) 的新版本. 用 Claude 分類條目並產生摘要, 用 Gemini 翻譯成台灣正體中文, 再送到 Discord.

## 需求

- Node.js 24 以上
- Discord webhook URL, Gemini API key
- Claude 認證: `claude setup-token` 產生的 OAuth token, 或 Anthropic API key

## 使用方式

1. 執行 `pnpm install`.
2. 執行 `pnpm start`.
3. 開啟後台 `http://127.0.0.1:3000`, 填入 Discord webhook URL, Gemini API key 和 Claude key, 按「儲存」.

設定完成前, 程式不會開始 tracking. 存檔後會立刻檢查一次, 之後依「檢查間隔」定時檢查. 後台的 Logs 區塊會顯示每次檢查的結果.

後台沒有密碼, API key 以明碼保存. 不要把後台的 port 開放到外網.

| 指令 | 說明 |
|---|---|
| `pnpm start` | 啟動後台並常駐 tracking |
| `pnpm run check` | 只檢查一次, 需要先在後台完成設定 |
| `pnpm run notify-latest` | 測試用, 直接通知最新版本, 不更新 state |

第一次檢查只記錄目前的最新版本, 不送通知.

`.env` 為選填, 只能設定 `DB_PATH`, `PORT`, `HOST`. 格式參考 `.env.example`.

資料保存在 SQLite `data/tracker.db`:

| 表 | key | value |
|---|---|---|
| `settings` | 設定名稱 | 設定值 |
| `state` | `lastVersion`, `etag` | 進度 |
| `releases` | 版本號 | 翻譯後的 release JSON |
| `logs` | 自動編號 | 時間, 等級, 訊息. 只保留最新 1000 筆 |

啟動時若找到舊版的 `data/state.json`, 而且 DB 還沒有進度, 會自動匯入, 並把原檔改名為 `state.json.imported`.

## 部署到樹莓派 (Docker)

需要 Pi 4 或 Pi 5, 並安裝 64-bit OS. Claude Code 沒有 32-bit ARM 版本.

1. 在已登入 Claude Code 的電腦上執行 `claude setup-token`, 記下產生的 token.
2. 把專案 (不含 `node_modules`) 複製到樹莓派.
3. 在樹莓派的專案目錄執行 `docker compose up -d --build`.
4. 開啟後台 `http://<樹莓派 IP>:3000`, 填入設定. Claude 認證方式選「OAuth token」, 填入第 1 步的 token.
5. 在後台的 Logs 區塊確認出現「初始化完成」.

設定和進度保存在 Docker volume `tracker-data`. 只要不刪除這個 volume, 重新 build 也不會重複通知, 也不用重新設定.

舊版放在 `.env` 的 `DISCORD_WEBHOOK_URL` 等設定已不再使用, 升級後要到後台重新填入.

## 開發

```sh
pnpm run typecheck
pnpm test
pnpm run docs   # 由 docs/src/*.mmd 產生 docs/architecture.html
```

架構圖和狀態流程圖在 `docs/architecture.html`. 這個檔案已內嵌所有資源, 離線也能開啟.
