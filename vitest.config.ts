import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@kingdomos/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@kingdomos/context-engine': resolve(__dirname, 'packages/context-engine/src/index.ts'),
      '@kingdomos/cli': resolve(__dirname, 'packages/cli/src/index.ts'),
      '@kingdomos/providers': resolve(__dirname, 'packages/providers/src/index.ts'),
      '@kingdomos/agents': resolve(__dirname, 'packages/agents/src/index.ts'),
      '@kingdomos/token-engine': resolve(__dirname, 'packages/token-engine/src/index.ts'),
      '@kingdomos/blacksmith': resolve(__dirname, 'packages/blacksmith/src/index.ts'),
      '@kingdomos/healer': resolve(__dirname, 'packages/healer/src/index.ts'),
      '@kingdomos/sentinel': resolve(__dirname, 'packages/sentinel/src/index.ts'),
      '@kingdomos/scribe': resolve(__dirname, 'packages/scribe/src/index.ts'),
    },
  },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
    },
  },
});
