import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { errorMessage, type LogStore } from './logs.ts';
import type { ReleaseStore } from './releases.ts';
import { DEFAULT_SETTINGS, mergeSettings, parseSettings, type SettingsStore } from './settings.ts';
import type { State } from './state.ts';

const ADMIN_HTML = readFileSync(new URL('./admin.html', import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_LOG_LIMIT = 200;
const MAX_FETCH_COUNT = 20;

export interface AdminDeps {
  settings: SettingsStore;
  logs: LogStore;
  releases: Pick<ReleaseStore, 'list'>;
  loadState(): State;
  onSettingsSaved(): void;
  // 在背景抓取最近 count 個版本. 已經在抓取時回傳 false.
  fetchRecent(count: number): boolean;
  isFetching(): boolean;
  notifyVersion(version: string): Promise<void>;
  retranslate(version: string): Promise<void>;
}

interface AdminStatus {
  ready: boolean;
  problems: string[];
  lastVersion: string | null;
  fetching: boolean;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 後台沒有密碼. 寫入的 API 只接受 application/json, 跨網域的這類請求一定會先送 preflight.
// 這裡不回應 CORS, 所以其他網站無法修改設定或送出通知.
export function createAdminServer(deps: AdminDeps): Server {
  return createServer((req, res) => {
    handle(deps, req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      sendJson(res, status, { error: errorMessage(error) });
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
    // 後台的「還原預設」用這裡的值.
    case 'GET /api/settings/defaults':
      return sendJson(res, 200, DEFAULT_SETTINGS);
    case 'PUT /api/settings': {
      const input = await readJsonObject(req);
      deps.settings.save(mergeSettings(deps.settings.load(), input));
      deps.onSettingsSaved();
      return sendJson(res, 200, getStatus(deps));
    }
    case 'GET /api/logs': {
      const limit = Number(url.searchParams.get('limit')) || DEFAULT_LOG_LIMIT;
      return sendJson(res, 200, deps.logs.recent(limit));
    }
    case 'GET /api/releases':
      return sendJson(res, 200, deps.releases.list());
    case 'POST /api/releases/fetch': {
      const { count } = await readJsonObject(req);
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_FETCH_COUNT) {
        throw new HttpError(400, `count 必須是 1 到 ${MAX_FETCH_COUNT} 的整數`);
      }
      if (!deps.fetchRecent(count)) throw new HttpError(409, '正在抓取版本, 請等目前的抓取完成');
      return sendJson(res, 202, getStatus(deps));
    }
    case 'POST /api/releases/notify': {
      const version = await readVersion(req);
      await deps.notifyVersion(version);
      return sendJson(res, 200, { version });
    }
    case 'POST /api/releases/retranslate': {
      const version = await readVersion(req);
      await deps.retranslate(version);
      return sendJson(res, 200, { version });
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
    fetching: deps.isFetching(),
  };
}

async function readVersion(req: IncomingMessage): Promise<string> {
  const { version } = await readJsonObject(req);
  if (typeof version !== 'string' || version === '') throw new HttpError(400, 'version 必須是非空字串');
  return version;
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  // text/plain 和表單的 POST 不需要 preflight, 擋掉它們才能防止其他網站送出請求.
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type 必須是 application/json');
  }

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
