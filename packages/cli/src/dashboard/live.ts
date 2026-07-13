// Alternate-screen live render loop for the terminal dashboard.

const ALT_ON = '\x1b[?1049h';   // switch to alternate screen buffer
const ALT_OFF = '\x1b[?1049l';  // restore main screen buffer
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const HOME = '\x1b[H';          // move cursor to top-left
const CLEAR = '\x1b[2J';        // clear entire screen
const CLEAR_DOWN = '\x1b[0J';   // clear from cursor to end of screen
const BEGIN_SYNC = '\x1b[?2026h'; // begin synchronized update (atomic paint)
const END_SYNC = '\x1b[?2026l';   // end synchronized update

export interface LiveLoopOptions {
  /** Refresh interval in milliseconds (default 1000) */
  intervalMs?: number;
  /**
   * Handle a non-quit keypress. Return true if the screen should be
   * redrawn immediately (e.g. the selection changed).
   */
  onKey?: (key: string) => boolean;
}

/**
 * Enter alternate screen, render `renderFrame()` every `intervalMs`,
 * and wait for the user to press `q` or Ctrl-C.
 *
 * If stdin is not a TTY (piped input), renders a single frame to stdout
 * and returns immediately.
 */
export function runLiveLoop(
  renderFrame: () => string | Promise<string>,
  opts: LiveLoopOptions = {}
): Promise<void> {
  const { intervalMs = 1000, onKey } = opts;

  return new Promise<void>((resolve) => {
    // Non-TTY guard — single render, no alternate screen
    if (!process.stdin.isTTY) {
      process.stderr.write('(dashboard: stdin is not a TTY — single render)\n');
      process.stdout.write(renderFrame() + '\n');
      resolve();
      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;
    let cleanedUp = false;
    let lastOutput = '';

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (timer) clearInterval(timer);
      process.stdout.write(SHOW_CURSOR + ALT_OFF);
      if (process.stdin.isTTY) {
        try { process.stdin.setRawMode(false); } catch { /* ignore */ }
        process.stdin.pause();
      }
      process.removeListener('SIGINT', onSignal);
      process.stdout.removeListener('resize', onResize);
      resolve();
    };

    // Reflow on terminal resize: full clear (shrinking leaves right/bottom
    // artifacts that CLEAR_DOWN alone cannot reach) and force a repaint.
    const onResize = () => {
      lastOutput = '';
      process.stdout.write(CLEAR);
      render();
    };

    const onSignal = () => cleanup();

    // Render loop — paints atomically and never scrolls.
    const render = async () => {
      try {
        let output = await renderFrame();
        // Clip to the viewport height so an over-tall frame can't scroll.
        const rows = process.stdout.rows && process.stdout.rows > 0 ? process.stdout.rows : 0;
        if (rows > 0) {
          const lines = output.split('\n');
          if (lines.length > rows) output = lines.slice(0, rows).join('\n');
        }
        // Skip the repaint entirely if nothing changed (kills idle flicker).
        if (output === lastOutput) return;
        lastOutput = output;
        // Synchronized update: the terminal buffers the whole frame and paints
        // it in one shot, so there is no visible tearing/flicker. CLEAR_DOWN
        // wipes any leftover lines from a previously taller frame.
        process.stdout.write(BEGIN_SYNC + HOME + output + CLEAR_DOWN + END_SYNC);
      } catch (err) {
        // Show error in-place rather than crashing
        lastOutput = '';
        process.stdout.write(HOME + CLEAR);
        process.stdout.write(`\n  Dashboard render error: ${(err as Error).message}\n`);
        process.stdout.write(`  Press q to exit.\n`);
      }
    };

    // Enter alt screen + hide cursor + clear
    process.stdout.write(ALT_ON + HIDE_CURSOR + CLEAR);

    // Fire first render, then set interval
    render();
    timer = setInterval(() => { render(); }, intervalMs);

    process.on('SIGINT', onSignal);
    process.stdout.on('resize', onResize);

    // Raw-mode stdin for keystroke capture
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data: Buffer) => {
      const key = data.toString();
      if (key === 'q' || key === '\x03') {
        //  = Ctrl-C
        if (timer) clearInterval(timer);
        timer = null;
        cleanup();
        return;
      }
      // Delegate navigation keys to the caller; redraw at once if handled.
      if (onKey && onKey(key)) {
        render();
      }
    });
  });
}
