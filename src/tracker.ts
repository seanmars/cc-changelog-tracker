import type { ClassifiedRelease } from './categories.ts';
import { findNewReleases, latestRelease, parseChangelog, type Release } from './changelog.ts';
import type { FetchResult } from './fetcher.ts';
import type { State } from './state.ts';

export interface TrackerDeps {
  fetchChangelog(etag: string | null): Promise<FetchResult>;
  loadState(): Promise<State>;
  saveState(state: State): Promise<void>;
  classify(release: Release): Promise<ClassifiedRelease>;
  translate(release: ClassifiedRelease): Promise<ClassifiedRelease>;
  save(release: ClassifiedRelease): Promise<void>;
  notify(release: ClassifiedRelease): Promise<void>;
  log(message: string): void;
}

async function processRelease(deps: TrackerDeps, release: Release): Promise<void> {
  const classified = await deps.classify(release);
  const translated = await deps.translate(classified);
  // 先存再通知, Discord 失敗時翻譯結果也不會遺失.
  await deps.save(translated);
  await deps.notify(translated);
}

function parseReleases(markdown: string): Release[] {
  const releases = parseChangelog(markdown);
  if (releases.length === 0) throw new Error('CHANGELOG 中找不到任何版本, 格式可能已改變');
  return releases;
}

// 測試用: 不看 state, 直接通知最新版本.
export async function notifyLatest(deps: TrackerDeps): Promise<void> {
  const result = await deps.fetchChangelog(null);
  if (result.status !== 'ok') throw new Error('無法下載 CHANGELOG');
  const latest = latestRelease(parseReleases(result.body));
  deps.log(`送出最新版本 ${latest.version} 的通知`);
  await processRelease(deps, latest);
}

export async function checkOnce(deps: TrackerDeps): Promise<void> {
  const state = await deps.loadState();
  const result = await deps.fetchChangelog(state.etag);
  if (result.status === 'not-modified') {
    deps.log('CHANGELOG 沒有變化');
    return;
  }

  const releases = parseReleases(result.body);

  // 第一次執行只記錄目前版本, 不送出歷史版本的通知.
  if (state.lastVersion === null) {
    const latest = latestRelease(releases).version;
    await deps.saveState({ lastVersion: latest, etag: result.etag });
    deps.log(`初始化完成, 目前最新版本 ${latest}`);
    return;
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
}
