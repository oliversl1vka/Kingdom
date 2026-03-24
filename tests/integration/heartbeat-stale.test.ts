import { describe, it, expect } from 'vitest';
import { HeartbeatMonitor } from '../../packages/sentinel/src/heartbeat-monitor.js';

describe('HeartbeatMonitor - Stale Detection', () => {
  it('should export HeartbeatMonitor class', () => {
    expect(typeof HeartbeatMonitor).toBe('function');
  });

  describe('checkForStaleJobs', () => {
    it.todo('should detect jobs with no heartbeat in 30 seconds');
    it.todo('should mark stale jobs as stalled');
    it.todo('should create incident reports for stale jobs');
    it.todo('should not flag jobs with recent heartbeats');
  });

  describe('start/stop', () => {
    it.todo('should start polling at configured interval');
    it.todo('should stop polling on stop()');
  });
});
