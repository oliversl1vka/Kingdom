import { createContextId } from '../ids.js';
import type { ContextChunkKind, ContextChunkRecord, ContextLanguage } from '../types.js';

export function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

export function sliceLines(content: string, startLine: number, endLine: number): string {
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(0, startLine - 1), endLine).join('\n');
}

export function createFileSummaryChunk(
  fileId: string,
  filePath: string,
  language: ContextLanguage,
  lineCount: number,
): ContextChunkRecord {
  const content = `${filePath}\nlanguage: ${language}\nlines: ${lineCount}`;
  return {
    id: createContextId('chk'),
    fileId,
    chunkKind: 'file_summary',
    title: filePath,
    content,
    filePath,
    language,
    startLine: lineCount > 0 ? 1 : 0,
    endLine: lineCount,
    tokenEstimate: estimateTokens(content),
  };
}

export function chunkPlainText(
  fileId: string,
  filePath: string,
  language: ContextLanguage,
  content: string,
  options: { chunkKind?: ContextChunkKind; windowLines?: number; overlapLines?: number; titlePrefix?: string } = {},
): ContextChunkRecord[] {
  const lines = content.split(/\r?\n/);
  const windowLines = options.windowLines ?? 80;
  const overlapLines = options.overlapLines ?? 10;
  const chunks: ContextChunkRecord[] = [];
  if (content.trim().length === 0) return chunks;

  for (let start = 0; start < lines.length; start += Math.max(1, windowLines - overlapLines)) {
    const end = Math.min(lines.length, start + windowLines);
    const chunkContent = lines.slice(start, end).join('\n');
    if (chunkContent.trim().length === 0) continue;
    chunks.push({
      id: createContextId('chk'),
      fileId,
      chunkKind: options.chunkKind ?? 'plain_block',
      title: `${options.titlePrefix ?? filePath}:${start + 1}-${end}`,
      content: chunkContent,
      filePath,
      language,
      startLine: start + 1,
      endLine: end,
      tokenEstimate: estimateTokens(chunkContent),
    });
    if (end >= lines.length) break;
  }
  return chunks;
}
