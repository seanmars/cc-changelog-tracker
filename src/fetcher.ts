export type FetchResult = { status: 'not-modified' } | { status: 'ok'; body: string; etag: string | null };

export async function fetchChangelog(url: string, etag: string | null): Promise<FetchResult> {
  const headers: Record<string, string> = {};
  if (etag) headers['If-None-Match'] = etag;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (res.status === 304) return { status: 'not-modified' };
  if (!res.ok) throw new Error(`下載 CHANGELOG 失敗: HTTP ${res.status}`);
  return { status: 'ok', body: await res.text(), etag: res.headers.get('etag') };
}
