import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'connector', include: ['test/**/*.test.ts'], testTimeout: 20000, environment: 'node' } });
