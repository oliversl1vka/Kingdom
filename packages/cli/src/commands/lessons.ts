import { Command } from 'commander';
import { theme } from '../theme.js';

/**
 * `kingdom lessons` — inspect and curate the cross-run lesson store.
 *
 * The lesson DB is populated automatically by the post-run distiller
 * (see packages/scribe/src/lesson-distiller.ts). Lessons are auto-injected
 * into King / Nobility / Healer prompts on the next run. This command gives
 * you:
 *   - `list`    — see what the agents will see
 *   - `forget`  — soft-delete a bad / outdated lesson (escape hatch)
 *
 * There is deliberately no `add` command in v1 — lessons are *distilled*,
 * not authored. If you want to leave a hand-written note, drop it into
 * `kingdom/memory/{tier}/lessons.md` (or `shared/lessons.md`); the prompt
 * assembler reads both.
 */
export function registerLessonsCommand(program: Command): void {
  const group = program.command('lessons').description('Inspect and curate cross-run agent lessons');

  group
    .command('list')
    .description('Show active lessons that will be injected on the next run')
    .option('--tier <tier>', 'Filter by tier (king|nobility|healer|judge|knight|squire|shared)')
    .option('--json', 'Machine-readable output')
    .action(async (options: { tier?: string; json?: boolean }) => {
      const { getDatabase, LessonsRepository } = await import('@kingdomos/core');
      const db = getDatabase();
      const repo = new LessonsRepository(db);

      const lessons = options.tier
        ? repo.listActiveByTier(options.tier, 1000)
        : repo.listAllActive();

      if (options.json) {
        console.log(JSON.stringify(lessons, null, 2));
        return;
      }

      if (lessons.length === 0) {
        theme.info(options.tier ? `No active lessons for tier "${options.tier}"` : 'No active lessons yet');
        return;
      }

      theme.info(`Active lessons (${lessons.length}${options.tier ? `, tier=${options.tier}` : ''}):`);
      for (const l of lessons) {
        console.log('');
        console.log(`  ${l.id}  ·  ${l.tier.padEnd(9)}  ·  ${l.rule_id}  ·  seen ${l.times_seen}×`);
        console.log(`    ${l.title}`);
        if (l.matches_failure_type) {
          console.log(`    matches_failure_type: ${l.matches_failure_type}`);
        }
      }
    });

  group
    .command('forget <id>')
    .description('Soft-delete a lesson so it stops being injected (reversible in the DB)')
    .action(async (id: string) => {
      const { getDatabase, LessonsRepository } = await import('@kingdomos/core');
      const db = getDatabase();
      const repo = new LessonsRepository(db);

      const lesson = repo.getById(id);
      if (!lesson) {
        theme.error(`No lesson with id ${id}`);
        process.exit(1);
      }
      if (!lesson.active) {
        theme.info(`Lesson ${id} is already forgotten`);
        return;
      }

      const ok = repo.forget(id);
      if (ok) {
        theme.success(`Forgotten: ${lesson.title}`);
      } else {
        theme.error(`Failed to forget lesson ${id}`);
        process.exit(1);
      }
    });
}
