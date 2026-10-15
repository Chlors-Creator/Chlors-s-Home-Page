import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface MusicDirectory {
  name: string;
  path: string;
  depth: number;
  children: MusicDirectory[];
}

export async function readMusicDirectories(root: string): Promise<MusicDirectory[]> {
  return readChildren(root, []);
}

async function readChildren(root: string, parentParts: string[]): Promise<MusicDirectory[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));

  return Promise.all(directories.map(async (entry) => {
    const parts = [...parentParts, entry.name];
    return {
      name: entry.name,
      path: parts.join('/'),
      depth: parentParts.length,
      children: await readChildren(join(root, entry.name), parts),
    };
  }));
}
