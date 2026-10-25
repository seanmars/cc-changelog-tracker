import { latestVersion, parseChangelog } from './changelog.ts';
import { createClassifier } from './classifier.ts';
import { loadServerConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { buildMessages, sendMessage } from './discord.ts';
import { fetchChangelog } from './fetcher.ts';
import { openLogStore, type LogLevel } from './logs.ts';
import { createScheduler } from './scheduler.ts';
import { createAdminServer } from './server.ts';
import { openSettingsStore, parseSettings, type TrackerConfig } from './settings.ts';
import { importLegacyState, openStateStore } from './state.ts';
import { openReleaseStore } from './store.ts';
import { checkOnce, processRelease, type TrackerDeps } from './tracker.ts';
import { createTranslator } from './translator.ts';

const serverConfig = loadServerConfig();
const db = openDatabase(serverConfig.dbPath);
const stateStore = openStateStore(db);
const store = openReleaseStore(db);
const settingsStore = openSettingsStore(db);
const logStore = openLogStore(db);

// 同時寫到 console 和 DB, 後台的 Logs 區塊讀取 DB.
function log(level: LogLevel, message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  logStore.add(level, message);
}

if (importLegacyState(stateStore, serverConfig.legacyStatePath)) {
  log('info', `已從 ${serverConfig.legacyStatePath} 匯入進度, 原檔改名為 .imported`);
}

// 每次檢查都用最新的設定建立, 後台改了設定就會在下次檢查生效.
function createDeps(config: TrackerConfig): TrackerDeps {
  return {
    fetchChangelog: (etag) => fetchChangelog(config.changelogUrl, etag),
    loadState: async () => stateStore.load(),
    saveState: async (state) => stateStore.save(state),
    classify: createClassifier(config.claudeModel, config.claudeAuth),
    translate: createTranslator(config.geminiApiKey, config.geminiModel),
    save: async (release) => store.put(release),
    notify: async (release) => {
      for (const message of buildMessages(release, config.linkUrl)) {
        await sendMessage(config.discordWebhookUrl, message);
      }
    },
    log: (message) => log('info', message),
  };
}

function requireConfig(): TrackerConfig {
  const result = parseSettings(settingsStore.load());
  if (!result.ok) throw new Error(`設定未完成, 請先到後台設定: ${result.problems.join(', ')}`);
  return result.config;
}

const args = new Set(process.argv.slice(2));

if (args.has('--notify-latest')) {
  // 測試用: 不看 state, 直接通知最新版本.
  const config = requireConfig();
  const result = await fetchChangelog(config.changelogUrl, null);
  if (result.status !== 'ok') throw new Error('無法下載 CHANGELOG');
  const releases = parseChangelog(result.body);
  const latest = releases.find((r) => r.version === latestVersion(releases))!;
  log('info', `送出最新版本 ${latest.version} 的通知`);
  await processRelease(createDeps(config), latest);
} else if (args.has('--once')) {
  await checkOnce(createDeps(requireConfig()));
} else {
  const scheduler = createScheduler({
    loadConfig: () => parseSettings(settingsStore.load()),
    check: (config) => checkOnce(createDeps(config)),
    log,
  });
  const server = createAdminServer({
    settings: settingsStore,
    logs: logStore,
    loadState: () => stateStore.load(),
    onSettingsSaved: () => scheduler.wake(),
  });

  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());

  server.listen(serverConfig.port, serverConfig.host, () => {
    log('info', `後台已啟動: http://${serverConfig.host}:${serverConfig.port}`);
  });
  await scheduler.run(controller.signal);

  server.closeAllConnections();
  server.close();
  log('info', '已停止');
}
