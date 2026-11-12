import { defineProject } from 'vitest/config';
export default defineProject({ test: { name: 'sim', include: ['test/**/*.test.ts'] } });
