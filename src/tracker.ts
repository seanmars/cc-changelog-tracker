import type { ClassifiedRelease } from './categories.ts';
import { compareVersions, findNewReleases, latestRelease, parseChangelog, type Release } from './changelog.ts';
import type { FetchResult } from './fetcher.ts';
import type { State } from './state.ts';

export interface TrackerDeps {
  fetchChangelog(etag: string | null): Promise<FetchResult>;
  loadState(): Promise<State>;
  saveState(state: State): Promise<void>;
  classify(release: Release): Promise<ClassifiedRelease>;
  translate(release: ClassifiedRelease): Promise<ClassifiedRelease>;
  find(version: string): Promise<ClassifiedRelease | undefined>;
  findSource(version: string): Promise<ClassifiedRelease | undefined>;
  save(release: ClassifiedRelease, source: ClassifiedRelease): Promise<void>;
  notify(release: ClassifiedRelease): Promise<void>;
  log(message: string): void;
}

async function translateRelease(deps: TrackerDeps, release: Release): Promise<ClassifiedRelease> {
  return translateSource(deps, await deps.classify(release));
}

// 翻譯分類後的原文, 原文和翻譯結果一起存, 之後可以只重新翻譯.
async function translateSource(deps: TrackerDeps, source: ClassifiedRelease): Promise<ClassifiedRelease> {
  const translated = await deps.translate(source);
  await deps.save(translated, source);
  return translated;
}

async function processRelease(deps: TrackerDeps, release: Release): Promise<void> {
  // 先存再通知, Discord 失敗時翻譯結果也不會遺失.
  const translated = await translateRelease(deps, release);
  await deps.notify(translated);
}

function parseReleases(markdown: string): Release[] {
  const releases = parseChangelog(markdown);
  if (releases.length === 0) throw new Error('CHANGELOG 中找不到任何版本, 格式可能已改變');
  return releases;
}

// 不帶 ETag 下載完整的 CHANGELOG, 給不依賴 state 的手動操作使用.
async function fetchAllReleases(deps: TrackerDeps): Promise<Release[]> {
  const result = await deps.fetchChangelog(null);
  if (result.status !== 'ok') throw new Error('無法下載 CHANGELOG');
  return parseReleases(result.body);
}

// 測試用: 不看 state, 直接通知最新版本.
export async function notifyLatest(deps: TrackerDeps): Promise<void> {
  const latest = latestRelease(await fetchAllReleases(deps));
  deps.log(`送出最新版本 ${latest.version} 的通知`);
  await processRelease(deps, latest);
}

// 抓取最近 count 個版本並存到 DB. 已經存過的版本不重新翻譯. 不送通知, 也不修改 state.
export async function fetchRecent(deps: TrackerDeps, count: number): Promise<void> {
  const recent = (await fetchAllReleases(deps))
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, count);
  deps.log(`開始抓取最近 ${recent.length} 個版本`);
  for (const release of recent) {
    if (await deps.find(release.version)) continue;
    deps.log(`翻譯版本 ${release.version} (${release.entries.length} 條)`);
    await translateRelease(deps, release);
  }
  deps.log(`最近 ${recent.length} 個版本抓取完成`);
}

async function findInChangelog(deps: TrackerDeps, version: string): Promise<Release> {
  const release = (await fetchAllReleases(deps)).find((r) => r.version === version);
  if (!release) throw new Error(`CHANGELOG 中找不到版本 ${version}`);
  return release;
}

// 手動送出指定版本的通知. DB 沒有這個版本時, 先分類和翻譯.
export async function notifyVersion(deps: TrackerDeps, version: string): Promise<void> {
  const release = (await deps.find(version)) ?? (await translateRelease(deps, await findInChangelog(deps, version)));
  deps.log(`手動送出版本 ${version} 的通知`);
  await deps.notify(release);
}

// 用目前的翻譯 prompt 重新翻譯並覆寫 DB, 不送通知.
// 有保存原文時只重新翻譯. 舊資料沒有原文時, 重新下載 CHANGELOG 並分類.
export async function retranslate(deps: TrackerDeps, version: string): Promise<void> {
  const source = await deps.findSource(version);
  if (source) {
    deps.log(`重新翻譯版本 ${version}`);
    await translateSource(deps, source);
  } else {
    deps.log(`重新翻譯版本 ${version}: 沒有保存原文, 重新下載 CHANGELOG 並分類`);
    await translateRelease(deps, await findInChangelog(deps, version));
  }
  deps.log(`版本 ${version} 重新翻譯完成`);
}

export type CheckResult = 'not-modified' | 'changed';

// 沒有變化時不寫 log, 避免 log 被重複的訊息佔滿. 呼叫端用回傳值顯示最後檢查的結果.
export async function checkOnce(deps: TrackerDeps): Promise<CheckResult> {
  const state = await deps.loadState();
  const result = await deps.fetchChangelog(state.etag);
  if (result.status === 'not-modified') return 'not-modified';

  const releases = parseReleases(result.body);

  // 第一次執行只記錄目前版本, 不送出歷史版本的通知.
  if (state.lastVersion === null) {
    const latest = latestRelease(releases).version;
    await deps.saveState({ lastVersion: latest, etag: result.etag });
    deps.log(`初始化完成, 目前最新版本 ${latest}`);
    return 'changed';
  }

  const newReleases = findNewReleases(releases, state.lastVersion);
  let lastVersion = state.lastVersion;
  for (const release of newReleases) {
    deps.log(`處理新版本 ${release.version} (${release.entries.length} 條)`);
    await processRelease(deps, release);
    lastVersion = release.version;
    // 每送出一個版本就保存進度, 但保留舊的 ETag, 失敗時下次才會重新下載並從這裡繼續.
    await deps.saveState({ lastVersion, etag: state.etag });
  }

  await deps.saveState({ lastVersion, etag: result.etag });
  if (newReleases.length === 0) deps.log('CHANGELOG 有變化, 但沒有新版本');
  return 'changed';
}
