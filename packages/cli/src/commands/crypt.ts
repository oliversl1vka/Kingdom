import { Command } from 'commander';
import { theme } from '../theme.js';

export function registerCryptCommand(program: Command): void {
  program
    .command('crypt')
    .description('Query the permanent history archive')
    .argument('[query]', 'Search term')
    .option('--last <n>', 'Show last N entries', '20')
    .option('--failures', 'Show only failed tasks')
    .option('--json', 'Machine-readable output')
    .action(async (query: string | undefined, options: { last: string; failures?: boolean; json?: boolean }) => {
      const { getDatabase } = await import('@kingdomos/core');
      const db = getDatabase();

      let sql = 'SELECT * FROM crypt_entries';
      const params: unknown[] = [];
      const conditions: string[] = [];

      if (query) {
        conditions.push('(title LIKE ? OR summary LIKE ?)');
        params.push(`%${query}%`, `%${query}%`);
      }
      if (options.failures) {
        conditions.push('success = 0');
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      sql += ' ORDER BY completed_at DESC LIMIT ?';
      params.push(parseInt(options.last, 10));

      const rows = db.prepare(sql).all(...params);

      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        theme.info('The Crypt of Kings');
        for (const row of rows as Array<{ title: string; summary: string; success: number; completed_at: string }>) {
          const status = row.success ? '✓' : '✗';
          console.log(`  ${status} [${row.completed_at}] ${row.title}: ${row.summary}`);
        }
      }
    });
}
