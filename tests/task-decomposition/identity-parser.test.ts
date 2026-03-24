import { describe, it, expect } from 'vitest';
import { parseIdentityMarkdown } from '../../packages/agents/src/identity-parser.js';

/**
 * T098: Agent Identity Parser Tests
 * Validates parsing of agent markdown identity files.
 */

describe('parseIdentityMarkdown', () => {
  const sampleKingMd = `# The King — Supreme Commander

## Tier
King

## Model Class
Strong reasoning model (GPT-4o class)

## Role
The King sits upon the throne and surveys the entire kingdom.

## Goals
- Decompose user objectives into well-structured epic-level tasks
- Assign appropriate tiers and models to each epic
- Ensure acceptance criteria are clear and measurable

## Allowed Tools
- Read project files for context
- Query the task graph database
- Create task graph nodes (epic level)

## Forbidden Behaviors
- Never write or modify source code files
- Never execute code or run tests directly
- Never access external APIs or the internet

## Output Format
JSON task graph with epics, acceptance criteria, and tier assignments

## Escalation Rules
- If an objective is ambiguous, request clarification from the user
- If token budget is insufficient for planning, report to the user

## Token Limits
16000`;

  it('should parse tier as lowercase', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.tier).toBe('king');
  });

  it('should parse model class', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.model_class).toBe('Strong reasoning model (GPT-4o class)');
  });

  it('should parse role description', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.role).toContain('throne');
  });

  it('should parse goals as array', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.goals).toHaveLength(3);
    expect(result.goals[0]).toContain('Decompose');
  });

  it('should parse allowed tools', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.allowed_tools).toHaveLength(3);
  });

  it('should parse forbidden behaviors', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.forbidden_behaviors).toHaveLength(3);
    expect(result.forbidden_behaviors[0]).toContain('Never write');
  });

  it('should parse output format', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.output_format).toContain('JSON');
  });

  it('should parse escalation rules', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.escalation_rules).toHaveLength(2);
  });

  it('should parse token limits as number', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.token_limits).toBe(16000);
  });

  it('should default token limits to 8000 if missing', () => {
    const noTokens = sampleKingMd.replace('## Token Limits\n16000', '');
    const result = parseIdentityMarkdown(noTokens);
    expect(result.token_limits).toBe(8000);
  });

  it('should omit delegation_rules when not present', () => {
    const result = parseIdentityMarkdown(sampleKingMd);
    expect(result.delegation_rules).toBeUndefined();
  });
});
