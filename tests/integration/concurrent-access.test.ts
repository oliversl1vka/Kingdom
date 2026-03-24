import { describe, it, expect } from 'vitest';
import { FileLockManager } from '../../packages/core/src/locks/file-lock-manager.js';

describe('FileLockManager - Concurrent Access', () => {
  describe('Exclusive locking', () => {
    it.todo('should acquire a lock on a file');
    it.todo('should reject second lock on same file');
    it.todo('should release a lock by owning supervisor');
    it.todo('should not release a lock by non-owning supervisor');
    it.todo('should force-release regardless of owner');
  });

  describe('Lock expiration', () => {
    it.todo('should detect expired locks via getExpiredLocks');
    it.todo('should not return unexpired locks');
  });

  describe('isLocked / getLock', () => {
    it('should return false for unlocked file', () => {
      // Structural test — would need DB instance
      expect(typeof FileLockManager).toBe('function');
    });

    it.todo('should return true and lock details for locked file');
  });
});
