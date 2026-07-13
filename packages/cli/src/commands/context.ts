import { Command } from 'commander';
import { resolve } from 'node:path';
import { theme } from '../theme.js';

interface ContextCommonOptions {
  projectId?: string;
  db?: string;
  json?: boolean;
}

export function registerContextCommand(program: Command): void {
  const group = program.command('context').description('Index and search local workspace context');

  group
    .command('index [path]')
    .description('Build or refresh the local context index')
    .option('--project-id <id>', 'Project id to index')
    .option('--db <path>', 'Context DB path, default kingdom/context.db')
    .option('--fresh', 'Delete the existing project index first')
    .option('--no-incremental', 'Reprocess unchanged files')
    .option('--include-generated', 'Include generated/build output files')
    .option('--orchestration-db <path>', 'Kingdom orchestration DB path for file lock checks')
    .option('--json', 'Machine-readable output')
    .action(async (targetPath: string | undefined, options: ContextCommonOptions & { fresh?: boolean; incremental?: boolean; includeGenerated?: boolean; orchestrationDb?: string }) => {
      const { indexContextProject } = await import('@kingdomos/context-engine');
      const result = indexContextProject({
        rootPath: resolve(targetPath ?? '.'),
        dbPath: options.db,
        projectId: options.projectId,
        fresh: options.fresh,
        incremental: options.incremental,
        includeGenerated: options.includeGenerated,
        orchestrationDbPath: options.orchestrationDb,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.status === 'failed') {
        theme.error('Context index failed');
      } else if (result.status === 'completed-with-warnings') {
        theme.warning('Context index completed with warnings');
      } else {
        theme.success('Context index complete');
      }
      console.log(`  Project: ${result.projectId}`);
      console.log(`  Files seen: ${result.filesSeen}`);
      console.log(`  Indexed: ${result.filesIndexed}`);
      console.log(`  Skipped unchanged: ${result.filesSkipped}`);
      console.log(`  Skipped locked: ${result.filesSkippedLocked}`);
      console.log(`  Skipped unstable: ${result.filesSkippedUnstable}`);
      console.log(`  Deleted: ${result.filesDeleted}`);
      console.log(`  Symbols: ${result.symbols}`);
      console.log(`  Chunks: ${result.chunks}`);
      console.log(`  Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
      for (const error of result.errors.slice(0, 10)) console.log(`  warning: ${error}`);
      if (result.status === 'failed') process.exit(1);
    });

  group
    .command('search <query...>')
    .description('Search the local context index')
    .option('--project-id <id>', 'Project id to search')
    .option('--db <path>', 'Context DB path, default kingdom/context.db')
    .option('--path <path>', 'Restrict results to a path substring')
    .option('--limit <n>', 'Maximum result count', parseInteger, 10)
    .option('--intent <intent>', 'Search intent override')
    .option('--max-tokens <n>', 'Approximate snippet token budget', parseInteger, 4000)
    .option('--no-snippets', 'Hide snippets')
    .option('--no-neighbors', 'Hide graph neighbors')
    .option('--no-rerank', 'Compatibility flag; deterministic ranker is always local')
    .option('--no-embeddings', 'Compatibility flag; embeddings are disabled in v1')
    .option('--json', 'Machine-readable output')
    .action(async (queryParts: string[], options: ContextCommonOptions & { path?: string; limit?: number; intent?: string; maxTokens?: number; snippets?: boolean; neighbors?: boolean; rerank?: boolean; embeddings?: boolean }) => {
      const { searchContext } = await import('@kingdomos/context-engine');
      const response = searchContext({
        query: queryParts.join(' '),
        dbPath: options.db,
        projectId: options.projectId,
        rootPath: process.cwd(),
        path: options.path,
        limit: options.limit,
        intent: options.intent as never,
        maxTokens: options.maxTokens,
        includeSnippets: options.snippets,
        includeNeighbors: options.neighbors,
        noRerank: options.rerank === false,
        noEmbeddings: options.embeddings === false,
      });
      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }
      for (const warning of response.warnings) theme.warning(warning);
      if (response.results.length === 0) {
        theme.info('No context results');
        return;
      }
      for (const result of response.results) {
        console.log(`${result.score.toFixed(2)} ${result.file}:${result.startLine}-${result.endLine} ${result.title}`);
        console.log(`     why: ${result.why.join(', ')}`);
        if (result.snippet) console.log(indentSnippet(result.snippet));
        if (result.neighbors && result.neighbors.length > 0) {
          console.log(`     neighbors: ${result.neighbors.map((n) => `${n.file}:${n.startLine}-${n.endLine}`).join(', ')}`);
        }
      }
    });

  group
    .command('status')
    .description('Report local context index health')
    .option('--project-id <id>', 'Project id to inspect')
    .option('--db <path>', 'Context DB path, default kingdom/context.db')
    .option('--json', 'Machine-readable output')
    .action(async (options: ContextCommonOptions) => {
      const { getContextStatus } = await import('@kingdomos/context-engine');
      const status = getContextStatus({ dbPath: options.db, projectId: options.projectId, rootPath: process.cwd() });
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      theme.info(status.indexed ? 'Context index status' : 'Context index missing');
      console.log(`  Project: ${status.projectId ?? '(none)'}`);
      console.log(`  Files: ${status.fileCount}`);
      console.log(`  Symbols: ${status.symbolCount}`);
      console.log(`  Chunks: ${status.chunkCount}`);
      console.log(`  Deleted/Stale/New/Missing: ${status.deletedFileCount}/${status.staleFileCount}/${status.newFileCount}/${status.missingFileCount}`);
      console.log(`  FTS rows: ${status.ftsRowCount}`);
      console.log(`  FTS ready: ${status.ftsReady ? 'yes' : 'no'}`);
      console.log(`  Embeddings: ${status.embeddingStatus}`);
      for (const warning of status.warnings) theme.warning(warning);
    });

  group
    .command('repair')
    .description('Repair context DB derived state')
    .option('--project-id <id>', 'Project id to repair')
    .option('--db <path>', 'Context DB path, default kingdom/context.db')
    .option('--fts-only', 'Rebuild only FTS rows from chunks')
    .option('--json', 'Machine-readable output')
    .action(async (options: ContextCommonOptions & { ftsOnly?: boolean }) => {
      const { repairContextIndex } = await import('@kingdomos/context-engine');
      try {
        const result = repairContextIndex({ dbPath: options.db, projectId: options.projectId, rootPath: process.cwd(), ftsOnly: options.ftsOnly });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        theme.success('Context repair complete');
        for (const fix of result.fixes) console.log(`  ${fix}`);
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2));
        } else {
          theme.error(error instanceof Error ? error.message : String(error));
        }
        process.exit(1);
      }
    });
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Expected positive integer, got ${value}`);
  return parsed;
}

function indentSnippet(snippet: string): string {
  return snippet
    .split('\n')
    .slice(0, 18)
    .map((line) => `     ${line}`)
    .join('\n');
}
