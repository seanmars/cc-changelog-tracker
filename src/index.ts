import { createClassifier } from './classifier.ts';
import { loadServerConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { buildMessages, sendMessage } from './discord.ts';
import { fetchChangelog } from './fetcher.ts';
import { openLogStore, type LogLevel } from './logs.ts';
import { openReleaseStore } from './releases.ts';
import { createScheduler } from './scheduler.ts';
import { createAdminServer } from './server.ts';
import { openSettingsStore, parseSettings, type ParseResult, type TrackerConfig } from './settings.ts';
import { openStateStore } from './state.ts';
import { checkOnce, notifyLatest, type TrackerDeps } from './tracker.ts';
import { createTranslator } from './translator.ts';

const serverConfig = loadServerConfig();
const db = openDatabase(serverConfig.dbPath);
const settingsStore = openSettingsStore(db);
const stateStore = openStateStore(db);
const releaseStore = openReleaseStore(db);
const logStore = openLogStore(db);

// 同時寫到 console 和 DB, 後台的 Logs 區塊讀取 DB.
function log(level: LogLevel, message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  logStore.add(level, message);
}

// 每次檢查都用最新的設定建立, 後台改了設定就會在下次檢查生效.
function createDeps(config: TrackerConfig): TrackerDeps {
  return {
    fetchChangelog: (etag) => fetchChangelog(config.changelogUrl, etag),
    loadState: async () => stateStore.load(),
    saveState: async (state) => stateStore.save(state),
    classify: createClassifier(config.claudeModel, config.claudeAuth),
    translate: createTranslator(config.geminiApiKey, config.geminiModel),
    save: async (release) => releaseStore.put(release),
    notify: async (release) => {
      for (const message of buildMessages(release, config.linkUrl)) {
        await sendMessage(config.discordWebhookUrl, message);
      }
    },
    log: (message) => log('info', message),
  };
}

function loadConfig(): ParseResult {
  return parseSettings(settingsStore.load());
}

function requireConfig(): TrackerConfig {
  const result = loadConfig();
  if (!result.ok) throw new Error(`設定未完成, 請先到後台設定: ${result.problems.join(', ')}`);
  return result.config;
}

const args = new Set(process.argv.slice(2));

if (args.has('--notify-latest')) {
  await notifyLatest(createDeps(requireConfig()));
} else if (args.has('--once')) {
  await checkOnce(createDeps(requireConfig()));
} else {
  const scheduler = createScheduler({
    loadConfig,
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
