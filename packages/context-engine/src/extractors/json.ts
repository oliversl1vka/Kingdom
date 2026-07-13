import { createContextId } from '../ids.js';
import { chunkPlainText, estimateTokens } from '../chunking/text.js';
import type { ContextChunkRecord, ExtractedContext, ScannedFile } from '../types.js';

export function extractJsonContext(file: ScannedFile, fileId: string): ExtractedContext {
  try {
    const parsed = JSON.parse(file.content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { symbols: [], chunks: chunkPlainText(fileId, file.path, file.language, file.content), edges: [] };
    }

    const chunks: ContextChunkRecord[] = [];
    const objectValue = parsed as Record<string, unknown>;
    for (const [key, value] of Object.entries(objectValue)) {
      const rendered = JSON.stringify({ [key]: value }, null, 2) ?? '';
      const location = findJsonKeyLine(file.content, key);
      chunks.push({
        id: createContextId('chk'),
        fileId,
        chunkKind: 'json_object',
        title: key,
        content: rendered,
        filePath: file.path,
        language: file.language,
        startLine: location,
        endLine: Math.min(file.lineCount, location + rendered.split(/\r?\n/).length - 1),
        tokenEstimate: estimateTokens(rendered),
      });
    }
    return { symbols: [], chunks, edges: [] };
  } catch {
    return { symbols: [], chunks: chunkPlainText(fileId, file.path, file.language, file.content), edges: [] };
  }
}

function findJsonKeyLine(content: string, key: string): number {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`"${escaped}"\\s*:`);
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => regex.test(line));
  return index >= 0 ? index + 1 : 1;
}
