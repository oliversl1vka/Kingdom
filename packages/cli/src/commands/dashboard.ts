import { Command } from 'commander';

export function registerDashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Live KingdomOS terminal dashboard with tier portraits and real-time status')
    .option('--once', 'Render a single frame to stdout and exit', false)
    .option(
      '--width <n>',
      'Target render width in columns (default: terminal width)',
      String(process.stdout.columns || 120)
    )
    .action(async (options: { once: boolean; width: string }) => {
      // Track the real terminal size live unless --width was passed explicitly.
      const widthExplicit = process.argv.some((a) => a === '--width' || a.startsWith('--width='));
      const fixedWidth = parseInt(options.width, 10) || (process.stdout.columns || 120);
      const liveWidth = () => (widthExplicit ? fixedWidth : (process.stdout.columns || 120));
      const width = fixedWidth;

      // Dynamic imports — follow the same pattern as status.ts
      const { getDatabase } = await import('@kingdomos/core');
      const { buildSnapshot } = await import('../dashboard/snapshot.js');
      const { getDashboardRenderer, buildContext } = await import('../dashboard/bridge.js');

      const db = getDatabase();

      // Build the initial context (snapshot + ANSI engine + tier metadata)
      const snapshot = buildSnapshot(db);
      const ctx = await buildContext(snapshot, {
        color: !process.argv.includes('--no-color') && process.env.NO_COLOR === undefined,
        width,
        frame: 0,
      });

      const renderFn = await getDashboardRenderer();

      if (options.once) {
        // Single frame — write to stdout and exit
        process.stdout.write(renderFn(ctx) + '\n');
        return;
      }

      // Live mode — alternate screen, auto-refresh, arrow-key agent browsing.
      const { runLiveLoop } = await import('../dashboard/live.js');
      let frame = 0;
      let selected = 0;
      const tierCount = ctx.TIER_ORDER.length;

      await runLiveLoop(
        async () => {
          // Re-read the DB each tick for live updates; re-read the terminal
          // size too so resizes reflow the layout instead of clipping it.
          const snap = buildSnapshot(db);
          const liveCtx = await buildContext(snap, {
            color: !process.argv.includes('--no-color') && process.env.NO_COLOR === undefined,
            width: liveWidth(),
            height: process.stdout.rows || 0,
            frame: frame++,
            selected,
          });
          return renderFn(liveCtx);
        },
        {
          onKey: (key: string): boolean => {
            // Right/Down arrow, l, or Tab → next agent
            if (key === '\x1b[C' || key === '\x1b[B' || key === 'l' || key === '\t') {
              selected = (selected + 1) % tierCount;
              return true;
            }
            // Left/Up arrow or h → previous agent
            if (key === '\x1b[D' || key === '\x1b[A' || key === 'h') {
              selected = (selected - 1 + tierCount) % tierCount;
              return true;
            }
            return false;
          },
        }
      );
    });
}
