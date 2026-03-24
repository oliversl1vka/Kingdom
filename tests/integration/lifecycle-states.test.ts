import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  getValidTransitions,
  isTerminalStatus,
  isFailedStatus,
  isActiveStatus,
  assertTransition,
} from '../../packages/core/src/job/lifecycle.js';

/**
 * T097/T098: Job Lifecycle State Machine Tests
 * Validates all transitions per data-model.md status lifecycle.
 */

describe('Job Lifecycle State Machine', () => {
  describe('valid transitions', () => {
    it('queued → preparing-context', () => {
      expect(isValidTransition('queued', 'preparing-context')).toBe(true);
    });

    it('preparing-context → awaiting-budget-check', () => {
      expect(isValidTransition('preparing-context', 'awaiting-budget-check')).toBe(true);
    });

    it('awaiting-budget-check → running', () => {
      expect(isValidTransition('awaiting-budget-check', 'running')).toBe(true);
    });

    it('awaiting-budget-check → budget-rejected', () => {
      expect(isValidTransition('awaiting-budget-check', 'budget-rejected')).toBe(true);
    });

    it('budget-rejected → queued', () => {
      expect(isValidTransition('budget-rejected', 'queued')).toBe(true);
    });

    it('running → completed', () => {
      expect(isValidTransition('running', 'completed')).toBe(true);
    });

    it('running → streaming', () => {
      expect(isValidTransition('running', 'streaming')).toBe(true);
    });

    it('running → stalled', () => {
      expect(isValidTransition('running', 'stalled')).toBe(true);
    });

    it('running → cancel-requested', () => {
      expect(isValidTransition('running', 'cancel-requested')).toBe(true);
    });

    it('running → all failure types', () => {
      expect(isValidTransition('running', 'failed-token-overflow')).toBe(true);
      expect(isValidTransition('running', 'failed-timeout')).toBe(true);
      expect(isValidTransition('running', 'failed-runtime-crash')).toBe(true);
      expect(isValidTransition('running', 'failed-invalid-output')).toBe(true);
      expect(isValidTransition('running', 'failed-review')).toBe(true);
    });

    it('stalled → running (recovery)', () => {
      expect(isValidTransition('stalled', 'running')).toBe(true);
    });

    it('cancel-requested → cancelled', () => {
      expect(isValidTransition('cancel-requested', 'cancelled')).toBe(true);
    });

    it('failed-* → retrying', () => {
      expect(isValidTransition('failed-token-overflow', 'retrying')).toBe(true);
      expect(isValidTransition('failed-timeout', 'retrying')).toBe(true);
      expect(isValidTransition('failed-runtime-crash', 'retrying')).toBe(true);
      expect(isValidTransition('failed-invalid-output', 'retrying')).toBe(true);
      expect(isValidTransition('failed-review', 'retrying')).toBe(true);
    });

    it('failed-* → awaiting-healer', () => {
      expect(isValidTransition('failed-token-overflow', 'awaiting-healer')).toBe(true);
      expect(isValidTransition('failed-timeout', 'awaiting-healer')).toBe(true);
    });

    it('retrying → running', () => {
      expect(isValidTransition('retrying', 'running')).toBe(true);
    });

    it('awaiting-healer → awaiting-redesign', () => {
      expect(isValidTransition('awaiting-healer', 'awaiting-redesign')).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    it('queued → completed (skip required steps)', () => {
      expect(isValidTransition('queued', 'completed')).toBe(false);
    });

    it('completed → running (terminal state)', () => {
      expect(isValidTransition('completed', 'running')).toBe(false);
    });

    it('cancelled → running (terminal state)', () => {
      expect(isValidTransition('cancelled', 'running')).toBe(false);
    });

    it('awaiting-redesign → running (terminal state)', () => {
      expect(isValidTransition('awaiting-redesign', 'running')).toBe(false);
    });
  });

  describe('isTerminalStatus', () => {
    it('should identify terminal statuses', () => {
      expect(isTerminalStatus('completed')).toBe(true);
      expect(isTerminalStatus('completed-with-warnings')).toBe(true);
      expect(isTerminalStatus('cancelled')).toBe(true);
      expect(isTerminalStatus('awaiting-redesign')).toBe(true);
    });

    it('should reject non-terminal statuses', () => {
      expect(isTerminalStatus('running')).toBe(false);
      expect(isTerminalStatus('queued')).toBe(false);
    });
  });

  describe('isFailedStatus', () => {
    it('should identify failed statuses', () => {
      expect(isFailedStatus('failed-token-overflow')).toBe(true);
      expect(isFailedStatus('failed-timeout')).toBe(true);
      expect(isFailedStatus('failed-runtime-crash')).toBe(true);
      expect(isFailedStatus('failed-invalid-output')).toBe(true);
      expect(isFailedStatus('failed-review')).toBe(true);
    });

    it('should reject non-failed statuses', () => {
      expect(isFailedStatus('completed')).toBe(false);
      expect(isFailedStatus('running')).toBe(false);
    });
  });

  describe('isActiveStatus', () => {
    it('should identify active statuses', () => {
      expect(isActiveStatus('running')).toBe(true);
      expect(isActiveStatus('streaming')).toBe(true);
      expect(isActiveStatus('preparing-context')).toBe(true);
      expect(isActiveStatus('awaiting-budget-check')).toBe(true);
    });
  });

  describe('assertTransition', () => {
    it('should not throw for valid transitions', () => {
      expect(() => assertTransition('queued', 'preparing-context')).not.toThrow();
    });

    it('should throw for invalid transitions', () => {
      expect(() => assertTransition('queued', 'completed')).toThrow('Invalid status transition');
    });
  });
});
