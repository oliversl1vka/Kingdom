import { createServer } from './server.js';
import { join, resolve } from 'node:path';

// Resolve to monorepo root (two levels up from packages/ui)
const basePath = resolve(import.meta.dirname, '..', '..', '..');
const kingdomDir = join(basePath, 'kingdom');

createServer({ port: 7778, kingdomDir })
  .then(() => console.log('API server running on http://127.0.0.1:7778'))
  .catch((err) => {
    console.error('Failed to start API server:', err);
    process.exit(1);
  });
