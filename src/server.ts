import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { LogStore } from './logs.ts';
import { mergeSettings, parseSettings, type SettingsStore } from './settings.ts';
import type { State } from './state.ts';

const ADMIN_HTML = readFileSync(new URL('./admin.html', import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_LOG_LIMIT = 200;
const MAX_LOG_LIMIT = 1000;

export interface AdminDeps {
  settings: SettingsStore;
  logs: LogStore;
  loadState(): State;
  onSettingsSaved(): void;
}

export interface AdminStatus {
  ready: boolean;
  problems: string[];
  lastVersion: string | null;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 後台沒有密碼. 跨網域的 PUT 一定會先送 preflight, 這裡不回應 CORS, 所以其他網站無法修改設定.
export function createAdminServer(deps: AdminDeps): Server {
  return createServer((req, res) => {
    handle(deps, req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
    });
  });
}

async function handle(deps: AdminDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  switch (`${req.method} ${url.pathname}`) {
    case 'GET /':
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(ADMIN_HTML);
      return;
    case 'GET /api/status':
      return sendJson(res, 200, getStatus(deps));
    case 'GET /api/settings':
      return sendJson(res, 200, deps.settings.load());
    case 'PUT /api/settings': {
      const input = await readJsonObject(req);
      deps.settings.save(mergeSettings(deps.settings.load(), input));
      deps.onSettingsSaved();
      return sendJson(res, 200, getStatus(deps));
    }
    case 'GET /api/logs': {
      const limit = Number(url.searchParams.get('limit')) || DEFAULT_LOG_LIMIT;
      return sendJson(res, 200, deps.logs.recent(Math.min(limit, MAX_LOG_LIMIT)));
    }
    default:
      throw new HttpError(404, '找不到這個路徑');
  }
}

function getStatus(deps: AdminDeps): AdminStatus {
  const result = parseSettings(deps.settings.load());
  return {
    ready: result.ok,
    problems: result.ok ? [] : result.problems,
    lastVersion: deps.loadState().lastVersion,
  };
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body 太大');
    chunks.push(chunk);
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 格式錯誤');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'request body 必須是 JSON object');
  }
  return value as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
