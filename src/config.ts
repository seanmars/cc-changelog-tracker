import { existsSync } from 'node:fs';

// 啟動 server 前就需要的設定. 其他設定都在後台管理, 存在 SQLite.
export interface ServerConfig {
  dbPath: string;
  host: string;
  port: number;
}

export function loadServerConfig(): ServerConfig {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT 必須是 0 到 65535 的整數');
  }

  return {
    dbPath: process.env.DB_PATH ?? 'data/tracker.db',
    // 後台沒有密碼, 預設只接受本機連線. Docker image 中改為 0.0.0.0.
    host: process.env.HOST ?? '127.0.0.1',
    port,
  };
}
