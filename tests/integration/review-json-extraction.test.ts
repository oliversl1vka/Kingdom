import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../../packages/core/src/json/extractor.js';
import { parseDesignReviewResponse } from '../../packages/core/src/job/dispatcher.js';
import { parseCriteriaReviewResponse } from '../../packages/core/src/review/reviewer.js';

describe('review JSON extraction', () => {
  it('extracts the fenced JSON object instead of greedily spanning surrounding braces', () => {
    const content = `ignore this object: {"note":"not the review"}


\`\`\`json
{"pass":false,"feedback":"missing architecture constraints"}
\`\`\`

and this trailing object: {"pass":true}`;

    expect(parseDesignReviewResponse(content)).toEqual({
      pass: false,
      feedback: 'missing architecture constraints',
    });
  });

  it('skips balanced objects that do not match the requested schema', () => {
    const content = `first {"note":"metadata only"} then {"pass":true,"feedback":"ok"}`;

    expect(extractJsonObject(content, (value): value is { pass: boolean } & Record<string, unknown> => typeof value.pass === 'boolean'))
      .toEqual({ pass: true, feedback: 'ok' });
  });

  it('parses criteria review JSON without greedy multi-object parsing', () => {
    const content = `review preface {"debug":"extra"}
{"criteria":[{"n":1,"pass":false,"evidence":"helper is missing"}],"pass":true,"feedback":"not done"}
tail {"pass":true}`;

    expect(parseCriteriaReviewResponse(content, ['helper exists'])).toEqual({
      pass: false,
      feedback: 'not done\n  x (1) helper exists - helper is missing',
    });
  });

  it('rejects design review JSON that lacks a boolean pass field', () => {
    expect(parseDesignReviewResponse('{"feedback":"ambiguous"}')).toBeNull();
  });
});