import type { AgentIdentity, AgentTier } from '@kingdomos/core';
import { readFileSync } from 'node:fs';

/**
 * Parse a markdown agent identity file into an AgentIdentity object.
 * Expects the format used in packages/agents/templates/*.md.
 */
export function parseIdentityFile(filePath: string): AgentIdentity {
  const content = readFileSync(filePath, 'utf-8');
  return parseIdentityMarkdown(content);
}

export function parseIdentityMarkdown(content: string): AgentIdentity {
  const sections = extractSections(content);

  const tier = extractSingleValue(sections, 'Tier') as AgentTier;
  const modelClass = extractSingleValue(sections, 'Model Class');
  const role = extractSingleValue(sections, 'Role');
  const goals = extractList(sections, 'Goals');
  const allowedTools = extractList(sections, 'Allowed Tools');
  const forbiddenBehaviors = extractList(sections, 'Forbidden Behaviors');
  const outputFormat = extractSingleValue(sections, 'Output Format');
  const escalationRules = extractList(sections, 'Escalation Rules');
  const delegationRules = extractList(sections, 'Delegation Rules');
  const reviewStandards = extractList(sections, 'Review Standards');
  const tokenLimits = parseInt(extractSingleValue(sections, 'Token Limits'), 10);

  return {
    tier: tier.toLowerCase() as AgentTier,
    model_class: modelClass,
    role,
    goals,
    allowed_tools: allowedTools,
    forbidden_behaviors: forbiddenBehaviors,
    output_format: outputFormat,
    escalation_rules: escalationRules,
    ...(delegationRules.length > 0 && { delegation_rules: delegationRules }),
    ...(reviewStandards.length > 0 && { review_standards: reviewStandards }),
    token_limits: isNaN(tokenLimits) ? 8000 : tokenLimits,
  };
}

function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  let currentHeading = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentHeading) {
        sections.set(currentHeading, currentBody.join('\n').trim());
      }
      currentHeading = headingMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentHeading) {
    sections.set(currentHeading, currentBody.join('\n').trim());
  }

  return sections;
}

function extractSingleValue(sections: Map<string, string>, key: string): string {
  const value = sections.get(key);
  return value?.trim() ?? '';
}

function extractList(sections: Map<string, string>, key: string): string[] {
  const value = sections.get(key);
  if (!value) return [];

  return value
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0);
}
