/**
 * PHASE5 §5.6 — IntegrationGate serialises critical sections (FIFO) and survives
 * a throwing section without poisoning the queue.
 */
import { describe, expect, it } from 'vitest';
import { IntegrationGate } from '@kingdomos/core';

describe('PHASE5 — IntegrationGate', () => {
  it('serialises overlapping critical sections (no interleave)', async () => {
    const gate = new IntegrationGate();
    const order: string[] = [];
    const section = (id: string) => async () => {
      order.push(`${id}:enter`);
      await new Promise((r) => setTimeout(r, 10));
      order.push(`${id}:exit`);
    };
    // Launch concurrently; they must run one-at-a-time in FIFO order.
    await Promise.all([
      gate.runExclusive(section('A')),
      gate.runExclusive(section('B')),
      gate.runExclusive(section('C')),
    ]);
    expect(order).toEqual([
      'A:enter', 'A:exit',
      'B:enter', 'B:exit',
      'C:enter', 'C:exit',
    ]);
  });

  it('a throwing section does not poison the queue', async () => {
    const gate = new IntegrationGate();
    const boom = gate.runExclusive(async () => { throw new Error('boom'); });
    await expect(boom).rejects.toThrow('boom');
    const after = await gate.runExclusive(async () => 'ok');
    expect(after).toBe('ok');
  });
});
