import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, findNewReleases, latestRelease, parseChangelog } from '../src/changelog.ts';

const SAMPLE = `# Changelog

## 2.1.10

- Added the Monitor tool
- [VSCode] Fixed the panel crash

## 2.1.9

- Improved startup time

## 2.1.8
`;

test('parseChangelog 依檔案順序解析版本和條目', () => {
  const releases = parseChangelog(SAMPLE);
  assert.deepEqual(releases, [
    { version: '2.1.10', entries: ['Added the Monitor tool', '[VSCode] Fixed the panel crash'] },
    { version: '2.1.9', entries: ['Improved startup time'] },
    { version: '2.1.8', entries: [] },
  ]);
});

test('parseChangelog 支援 CRLF 換行', () => {
  const releases = parseChangelog(SAMPLE.replaceAll('\n', '\r\n'));
  assert.equal(releases.length, 3);
  assert.equal(releases[0].entries[0], 'Added the Monitor tool');
});

test('compareVersions 用數字比較, 不是字串比較', () => {
  assert.ok(compareVersions('2.1.10', '2.1.9') > 0);
  assert.ok(compareVersions('2.0.0', '10.0.0') < 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('latestRelease 回傳最大版本', () => {
  assert.equal(latestRelease(parseChangelog(SAMPLE)).version, '2.1.10');
});

test('findNewReleases 回傳較新的版本, 由舊到新排序', () => {
  const result = findNewReleases(parseChangelog(SAMPLE), '2.1.8');
  assert.deepEqual(result.map((r) => r.version), ['2.1.9', '2.1.10']);
});

test('findNewReleases 沒有新版本時回傳空陣列', () => {
  assert.deepEqual(findNewReleases(parseChangelog(SAMPLE), '2.1.10'), []);
});
