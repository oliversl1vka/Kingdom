/**
 * PHASE5 (§5.6): process-level async mutex that serialises the *land* critical
 * section of agentic dispatch — commit + mergeBack + post-merge re-validate. The
 * agentic loop, review, and gates all run OUTSIDE this lock (fully parallel
 * across jobs); only the merge onto the shared integration branch is serialised.
 *
 * Implemented as a promise-chain mutex: each `runExclusive` call appends to a
 * tail promise and resolves when all prior critical sections have settled.
 *
 * When workers become separate processes (Phase 1 TODO), replace this with a DB
 * advisory lock so cross-process merges still serialise.
 */
export class IntegrationGate {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Run `fn` with exclusive access to the integration branch. Calls are FIFO and
   * a throw inside one critical section does not poison the queue for the next.
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    // Advance the tail regardless of success/failure so the next waiter proceeds.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Manual acquire form for critical sections that aren't a single callback (e.g.
   * the legacy in-place apply+gates block with many early returns). Resolves once
   * all prior sections have settled; call the returned function to release. FIFO,
   * and interoperates with {@link runExclusive} (both chain off the same tail).
   */
  async acquire(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const prior = this.tail;
    this.tail = prior.then(() => held, () => held);
    await prior;
    return release;
  }
}
