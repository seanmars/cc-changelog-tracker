export interface Release {
  version: string;
  entries: string[];
}

const HEADING = /^## (\d+\.\d+\.\d+)\s*$/;
const BULLET = /^- (.+)$/;

// CHANGELOG 由新到舊排列, 回傳順序與檔案相同.
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = HEADING.exec(line);
    if (heading) {
      current = { version: heading[1], entries: [] };
      releases.push(current);
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet && current) {
      current.entries.push(bullet[1].trim());
    }
  }
  return releases;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function latestVersion(releases: Release[]): string {
  return releases.map((r) => r.version).reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
}

// 回傳比 lastVersion 新的版本, 由舊到新排序, 方便依序通知.
export function findNewReleases(releases: Release[], lastVersion: string): Release[] {
  return releases
    .filter((r) => compareVersions(r.version, lastVersion) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}
