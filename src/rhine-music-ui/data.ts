import library from "../generated/music-library.json" with { type: "json" };
import definitions from "../data/playlists.json" with { type: "json" };

interface MusicTrack {
  title: string;
  artist: string;
  src: string;
  durationLabel: string;
}

interface PlaylistDefinition {
  title: string;
  description: string;
  directory: string;
  children?: PlaylistDefinition[];
}

export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
}

const tracksByDirectory = library.playlists as Record<string, MusicTrack[]>;
const definitionsByDirectory = new Map<string, PlaylistDefinition>();
for (const definition of definitions as PlaylistDefinition[]) {
  definitionsByDirectory.set(definition.directory, definition);
  for (const child of definition.children ?? []) {
    definitionsByDirectory.set(`${definition.directory}/${child.directory}`, child);
  }
}

const playlistEntries = Object.entries(tracksByDirectory)
  .filter(([, tracks]) => tracks.length > 0)
  .sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true }));
export const archiveColumns = playlistEntries.map(([directory]) => directory);
export const categories = ["全部档案", ...archiveColumns];

let recordNumber = 0;
export const records: ArchiveRecord[] = playlistEntries.flatMap(([directory, tracks]) => {
  const definition = definitionsByDirectory.get(directory);
  return tracks.map((track) => {
    recordNumber += 1;
    return {
      id: `X-${String(recordNumber).padStart(3, "0")}`,
      title: track.title,
      en: track.artist,
      department: definition?.title ?? directory,
      category: directory,
      date: `PUBLIC / MUSIC · ${directory}`,
      lead: track.artist,
      clearance: "AUTHORIZED",
      abstract: definition?.description ?? `音乐目录：${directory}`,
      findings: [`${track.title} — ${track.artist}`],
      source: track.src,
    };
  });
});

export function columnFiles(lane: number) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.category === archiveColumns[lane])
    .map(({ index }) => index);
}

export function fileLocation(index: number) {
  const lane = archiveColumns.indexOf(records[index].category);
  const row = 12 + columnFiles(lane).indexOf(index);
  return { lane, row, slot: lane * 32 + row };
}

export function fileAtSlot(slot: number) {
  const files = columnFiles(Math.floor(slot / 32));
  return files[Math.max(0, Math.min(files.length - 1, (slot % 32) - 12))];
}
