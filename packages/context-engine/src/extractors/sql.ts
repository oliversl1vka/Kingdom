import { createContextId } from '../ids.js';
import { chunkPlainText, estimateTokens, sliceLines } from '../chunking/text.js';
import type { ContextEdgeRecord, ExtractedContext, ScannedFile } from '../types.js';

export function extractSqlContext(file: ScannedFile, fileId: string): ExtractedContext {
  const lines = file.content.split(/\r?\n/);
  const chunks = [];
  const edges: ContextEdgeRecord[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const table = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.-]+[`"\]]?)/i);
    const indexMatch = line.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.-]+[`"\]]?)/i);
    const match = table ?? indexMatch;
    if (!match) continue;

    const name = match[1].replace(/^[`"\[]|[`"\]]$/g, '');
    const endLine = findSqlStatementEnd(lines, index);
    const content = sliceLines(file.content, index + 1, endLine);
    const chunkId = createContextId('chk');
    chunks.push({
      id: chunkId,
      fileId,
      chunkKind: 'sql_statement' as const,
      title: name,
      content,
      filePath: file.path,
      language: file.language,
      startLine: index + 1,
      endLine,
      tokenEstimate: estimateTokens(content),
    });
    edges.push({
      id: createContextId('edg'),
      sourceKind: 'file',
      sourceId: fileId,
      targetKind: 'sql',
      targetName: name,
      edgeType: table ? 'sql_defines_table' : 'sql_defines_index',
      confidence: 1,
    });
  }

  return { symbols: [], chunks: chunks.length > 0 ? chunks : chunkPlainText(fileId, file.path, file.language, file.content), edges };
}

function findSqlStatementEnd(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 80); index += 1) {
    if (lines[index].includes(';')) return index + 1;
  }
  return Math.min(lines.length, startIndex + 80);
}
