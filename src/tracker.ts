import type { ClassifiedRelease } from './categories.ts';
import { findNewReleases, latestVersion, parseChangelog, type Release } from './changelog.ts';
import type { FetchResult } from './fetcher.ts';
import type { State } from './state.ts';

export interface TrackerDeps {
  fetchChangelog(etag: string | null): Promise<FetchResult>;
  loadState(): Promise<State>;
  saveState(state: State): Promise<void>;
  classify(release: Release): Promise<ClassifiedRelease>;
  translate(release: ClassifiedRelease): Promise<ClassifiedRelease>;
  notify(release: ClassifiedRelease): Promise<void>;
  log(message: string): void;
}

export async function processRelease(deps: TrackerDeps, release: Release): Promise<void> {
  const classified = await deps.classify(release);
  const translated = await deps.translate(classified);
  await deps.notify(translated);
}

export async function checkOnce(deps: TrackerDeps): Promise<void> {
  const state = await deps.loadState();
  const result = await deps.fetchChangelog(state.etag);
  if (result.status === 'not-modified') {
    deps.log('CHANGELOG 沒有變化');
    return;
  }

  const releases = parseChangelog(result.body);
  if (releases.length === 0) throw new Error('CHANGELOG 中找不到任何版本, 格式可能已改變');

  // 第一次執行只記錄目前版本, 不送出歷史版本的通知.
  if (state.lastVersion === null) {
    const latest = latestVersion(releases);
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
