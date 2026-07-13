import { describe, it, expect } from 'vitest';
import {
  getAssignedTier,
  getReviewerTier,
  validateTierAssignment,
  validateReviewerTier,
  getDefaultTiers,
} from '../../packages/agents/src/tier-manager.js';

/**
 * T099: Tier Manager Tests
 * Validates tier assignment and reviewer tier logic per data-model.md rules.
 */

describe('getAssignedTier', () => {
  it('should assign nobility to epic level', () => {
    expect(getAssignedTier('epic')).toBe('nobility');
  });

  it('should assign knight to task level', () => {
    expect(getAssignedTier('task')).toBe('knight');
  });

  it('should assign squire to subtask level', () => {
    expect(getAssignedTier('subtask')).toBe('squire');
  });

  it('should assign squire to job level', () => {
    expect(getAssignedTier('job')).toBe('squire');
  });
});

describe('getReviewerTier', () => {
  it('should return king as reviewer for nobility', () => {
    expect(getReviewerTier('nobility')).toBe('king');
  });

  it('should return nobility as reviewer for knight', () => {
    expect(getReviewerTier('knight')).toBe('nobility');
  });

  it('should return knight as reviewer for squire', () => {
    expect(getReviewerTier('squire')).toBe('knight');
  });

  it('should return king as reviewer for king (self-review)', () => {
    expect(getReviewerTier('king')).toBe('king');
  });
});

describe('validateTierAssignment', () => {
  it('should validate correct tier assignments', () => {
    expect(validateTierAssignment('epic', 'nobility')).toBe(true);
    expect(validateTierAssignment('task', 'knight')).toBe(true);
    expect(validateTierAssignment('subtask', 'squire')).toBe(true);
    expect(validateTierAssignment('job', 'squire')).toBe(true);
  });

  it('should reject incorrect tier assignments', () => {
    expect(validateTierAssignment('epic', 'squire')).toBe(false);
    expect(validateTierAssignment('task', 'nobility')).toBe(false);
    expect(validateTierAssignment('subtask', 'knight')).toBe(false);
  });
});

describe('validateReviewerTier', () => {
  it('should allow reviewer at same tier', () => {
    expect(validateReviewerTier('knight', 'knight')).toBe(true);
  });

  it('should allow reviewer one level above', () => {
    expect(validateReviewerTier('knight', 'nobility')).toBe(true);
    expect(validateReviewerTier('squire', 'knight')).toBe(true);
  });

  it('should allow reviewer several levels above', () => {
    expect(validateReviewerTier('squire', 'king')).toBe(true);
  });

  it('should reject reviewer below assigned tier', () => {
    expect(validateReviewerTier('knight', 'squire')).toBe(false);
    expect(validateReviewerTier('nobility', 'squire')).toBe(false);
  });
});

describe('getDefaultTiers', () => {
  it('should return correct defaults for each level', () => {
    expect(getDefaultTiers('epic')).toEqual({ assigned: 'nobility', reviewer: 'king' });
    expect(getDefaultTiers('task')).toEqual({ assigned: 'knight', reviewer: 'nobility' });
    expect(getDefaultTiers('subtask')).toEqual({ assigned: 'squire', reviewer: 'knight' });
    expect(getDefaultTiers('job')).toEqual({ assigned: 'squire', reviewer: 'knight' });
  });
});
