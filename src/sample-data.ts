import { SAMPLE_DATA_GZIP_BASE64 } from './sample-data-generated.ts';
import type { BookmarkDraft } from './model.ts';

export async function loadSampleBookmarks(): Promise<BookmarkDraft[]> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This Obsidian runtime cannot decompress the optional sample library.');
  const binary = atob(SAMPLE_DATA_GZIP_BASE64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const content = await new Response(stream).text();
  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed) || parsed.length !== 100) throw new Error('The bundled sample library must contain 100 bookmarks.');
  return parsed as BookmarkDraft[];
}
