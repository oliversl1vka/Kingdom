import { describe, it, expect } from 'vitest';
import { isAllowedMethod, enforceBoundary, getViolations, clearViolations } from '../../packages/core/src/mcp/boundary.js';

describe('MCP Boundary Enforcement', () => {
  beforeEach(() => {
    clearViolations();
  });

  describe('isAllowedMethod', () => {
    it('should allow configured GitHub MCP methods', () => {
      expect(isAllowedMethod('github.issues.create')).toBe(true);
      expect(isAllowedMethod('github.pulls.create')).toBe(true);
      expect(isAllowedMethod('github.repos.get')).toBe(true);
    });

    it('should reject non-configured methods', () => {
      expect(isAllowedMethod('http.get')).toBe(false);
      expect(isAllowedMethod('shell.exec')).toBe(false);
      expect(isAllowedMethod('random.method')).toBe(false);
    });
  });

  describe('enforceBoundary', () => {
    it('should not throw for allowed methods', () => {
      expect(() => enforceBoundary('github.issues.create')).not.toThrow();
    });

    it('should throw for non-allowed methods', () => {
      expect(() => enforceBoundary('internet.browse')).toThrow('not in the allowed list');
    });

    it('should record boundary violations', () => {
      try { enforceBoundary('forbidden.method'); } catch {}
      const violations = getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0].method).toBe('forbidden.method');
    });
  });
});
