import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface State {
  lastVersion: string | null;
  etag: string | null;
}

export async function loadState(path: string): Promise<State> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as State;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { lastVersion: null, etag: null };
    throw error;
  }
}

// 先寫暫存檔再 rename, 避免程式中斷時留下寫到一半的檔案.
export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
  await rename(tempPath, path);
}
