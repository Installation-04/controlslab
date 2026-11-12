import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'plc-engine', include: ['test/**/*.test.ts'] } });
