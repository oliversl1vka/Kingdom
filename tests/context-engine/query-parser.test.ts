import { describe, expect, it } from 'vitest';
import { buildFtsQuery, parseContextQuery } from '@kingdomos/context-engine';

describe('context query parser', () => {
  it('extracts filters and infers flow intent', () => {
    const parsed = parseContextQuery('how does symbol:JobDispatcher file:dispatcher flow through review');

    expect(parsed.intent).toBe('flow');
    expect(parsed.filters.symbol).toBe('JobDispatcher');
    expect(parsed.filters.file).toBe('dispatcher');
    expect(parsed.textQuery).toBe('how does flow through review');
  });

  it('builds escaped FTS terms from identifiers', () => {
    const parsed = parseContextQuery('where is DoctorCommand implemented?');
    const fts = buildFtsQuery(parsed.terms);

    expect(parsed.terms).toContain('doctor');
    expect(parsed.terms).toContain('command');
    expect(fts).toContain('"doctor"');
  });
});
