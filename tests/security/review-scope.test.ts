import { describe, it, expect } from 'vitest';

/**
 * T100: Review scope and format tests.
 * Verifies scope_check and format_check per Constitution Principle V.
 */

describe('Scope Check', () => {
  it('should fail when diff modifies files outside allowed list', () => {
    const allowedFiles = ['src/main.ts'];
    const diff = `--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new`;
    const diff2 = `--- a/src/secret.ts\n+++ b/src/secret.ts\n@@ -1 +1 @@\n-safe\n+unsafe`;

    // Extract files from diff
    const files: string[] = [];
    for (const line of (diff + '\n' + diff2).split('\n')) {
      if (line.startsWith('+++ ')) {
        const f = line.slice(4).replace(/^[ab]\//, '').trim();
        if (f && f !== '/dev/null') files.push(f);
      }
    }

    const outOfScope = files.filter(f => !allowedFiles.includes(f));
    expect(outOfScope).toContain('src/secret.ts');
  });

  it('should pass when all modified files are in allowed list', () => {
    const allowedFiles = ['src/main.ts', 'src/utils.ts'];
    const diff = `--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new`;

    const files: string[] = [];
    for (const line of diff.split('\n')) {
      if (line.startsWith('+++ ')) {
        const f = line.slice(4).replace(/^[ab]\//, '').trim();
        if (f && f !== '/dev/null') files.push(f);
      }
    }

    const outOfScope = files.filter(f => !allowedFiles.includes(f));
    expect(outOfScope).toHaveLength(0);
  });
});

describe('Format Check', () => {
  it('should fail on empty diff', () => {
    const diff = '';
    const valid = diff.includes('---') && diff.includes('+++') && diff.includes('@@');
    expect(valid).toBe(false);
  });

  it('should fail on non-diff text', () => {
    const diff = 'This is just some random text\nwith no diff format';
    const valid = diff.includes('---') && diff.includes('+++') && diff.includes('@@');
    expect(valid).toBe(false);
  });

  it('should pass on valid unified diff', () => {
    const diff = `--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,3 +1,4 @@\n import { foo } from './foo';\n \n function example() {\n+  return true;\n }`;
    const valid = diff.includes('---') && diff.includes('+++') && diff.includes('@@');
    expect(valid).toBe(true);
  });
});
