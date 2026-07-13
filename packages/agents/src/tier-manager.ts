import type { AgentTier, TaskLevel } from '@kingdomos/core';

/**
 * Tier assignment rules per data-model.md:
 *   epic     → nobility
 *   task     → knight
 *   subtask  → squire
 *   job      → squire
 *
 * Reviewer tier must be equal to or one level above assigned tier.
 */

const LEVEL_TO_TIER: Record<TaskLevel, AgentTier> = {
  epic: 'nobility',
  task: 'knight',
  subtask: 'squire',
  job: 'squire',
};

const TIER_RANK: Record<string, number> = {
  king: 0,
  nobility: 1,
  knight: 2,
  squire: 3,
};

const RANK_TO_TIER: Record<number, AgentTier> = {
  0: 'king',
  1: 'nobility',
  2: 'knight',
  3: 'squire',
};

export function getAssignedTier(level: TaskLevel): AgentTier {
  return LEVEL_TO_TIER[level];
}

export function getReviewerTier(assignedTier: AgentTier): AgentTier {
  const rank = TIER_RANK[assignedTier];
  if (rank === undefined || rank === 0) return assignedTier;
  return RANK_TO_TIER[rank - 1];
}

export function validateTierAssignment(level: TaskLevel, tier: AgentTier): boolean {
  return LEVEL_TO_TIER[level] === tier;
}

export function validateReviewerTier(assignedTier: AgentTier, reviewerTier: AgentTier): boolean {
  const assignedRank = TIER_RANK[assignedTier];
  const reviewerRank = TIER_RANK[reviewerTier];
  if (assignedRank === undefined || reviewerRank === undefined) return false;
  return reviewerRank <= assignedRank;
}

export function getDefaultTiers(level: TaskLevel): { assigned: AgentTier; reviewer: AgentTier } {
  const assigned = getAssignedTier(level);
  const reviewer = getReviewerTier(assigned);
  return { assigned, reviewer };
}
