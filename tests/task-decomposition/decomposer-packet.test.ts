import { describe, it, expect } from 'vitest';

/**
 * T100: Task Decomposition & Job Packet Assembly Tests
 * Tests decomposer and job packet assembler contracts.
 */

describe('TaskDecomposer', () => {
  it.todo('should decompose an epic into tasks via LLM call');
  it.todo('should decompose a task into subtasks');
  it.todo('should refuse to decompose a job-level task');
  it.todo('should return existing children if already decomposed');
  it.todo('should parse JSON response from LLM including code blocks');
  it.todo('should assign correct tiers to child tasks');
});

describe('JobPacketAssembler', () => {
  it.todo('should create a job record in the database');
  it.todo('should set output_format to unified-diff for code tasks');
  it.todo('should set output_format to markdown for research tasks');
  it.todo('should include agent identity as system message');
  it.todo('should include context from referenced files');
  it.todo('should reject tasks that are not job/subtask level');
});
