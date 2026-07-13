import { createContextId } from '../ids.js';
import { estimateTokens, sliceLines } from '../chunking/text.js';
import type { ExtractedContext, ScannedFile } from '../types.js';

export function extractMarkdownContext(file: ScannedFile, fileId: string): ExtractedContext {
  const lines = file.content.split(/\r?\n/);
  const headings: Array<{ line: number; level: number; title: string }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) headings.push({ line: index + 1, level: match[1].length, title: match[2].trim() });
  });

  if (headings.length === 0) {
    return { symbols: [], chunks: [], edges: [] };
  }

  const chunks = headings.map((heading, index) => {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const endLine = Math.min(next ? next.line - 1 : lines.length, heading.line + 200);
    const content = sliceLines(file.content, heading.line, endLine);
    return {
      id: createContextId('chk'),
      fileId,
      chunkKind: 'markdown_section' as const,
      title: heading.title,
      content,
      filePath: file.path,
      language: file.language,
      startLine: heading.line,
      endLine,
      tokenEstimate: estimateTokens(content),
    };
  });

  return { symbols: [], chunks, edges: [] };
}
