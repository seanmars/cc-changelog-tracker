import { setTimeout as sleep } from 'node:timers/promises';
import { latestVersion, parseChangelog } from './changelog.ts';
import { createClassifier } from './classifier.ts';
import { loadConfig } from './config.ts';
import { buildMessages, sendMessage } from './discord.ts';
import { fetchChangelog } from './fetcher.ts';
import { openDatabase } from './db.ts';
import { importLegacyState, openStateStore } from './state.ts';
import { openReleaseStore } from './store.ts';
import { checkOnce, processRelease, type TrackerDeps } from './tracker.ts';
import { createTranslator } from './translator.ts';

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const config = loadConfig();
const db = openDatabase(config.dbPath);
const stateStore = openStateStore(db);
const store = openReleaseStore(db);
if (importLegacyState(stateStore, config.legacyStatePath)) {
  log(`已從 ${config.legacyStatePath} 匯入進度, 原檔改名為 .imported`);
}

const deps: TrackerDeps = {
  fetchChangelog: (etag) => fetchChangelog(config.changelogUrl, etag),
  loadState: async () => stateStore.load(),
  saveState: async (state) => stateStore.save(state),
  classify: createClassifier(config.claudeModel),
  translate: createTranslator(config.geminiApiKey, config.geminiModel),
  save: async (release) => store.put(release),
  notify: async (release) => {
    for (const message of buildMessages(release, config.linkUrl)) {
      await sendMessage(config.discordWebhookUrl, message);
    }
  },
  log,
};

const args = new Set(process.argv.slice(2));

if (args.has('--notify-latest')) {
  // 測試用: 不看 state, 直接通知最新版本.
  const result = await fetchChangelog(config.changelogUrl, null);
  if (result.status !== 'ok') throw new Error('無法下載 CHANGELOG');
  const releases = parseChangelog(result.body);
  const latest = releases.find((r) => r.version === latestVersion(releases))!;
  log(`送出最新版本 ${latest.version} 的通知`);
  await processRelease(deps, latest);
} else if (args.has('--once')) {
  await checkOnce(deps);
} else {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  log(`開始追蹤, 每 ${config.checkIntervalMinutes} 分鐘檢查一次`);

  // 每次檢查完成後才開始計時, 所以不會有兩次檢查同時執行.
  while (!controller.signal.aborted) {
    try {
      await checkOnce(deps);
    } catch (error) {
      log(`檢查失敗, 下次重試: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(config.checkIntervalMinutes * 60_000, undefined, { signal: controller.signal }).catch(() => {});
  }
  log('已停止');
}
