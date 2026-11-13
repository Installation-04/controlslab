import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'ladder', include: ['test/**/*.test.ts'], testTimeout: 30000 } });
