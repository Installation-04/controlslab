// SPDX-License-Identifier: AGPL-3.0-only
// Bundles the connector (and its `ws` dependency) into ONE self-contained file:
//   dist-connector/controlslab-connector.mjs   — run with: node controlslab-connector.mjs
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('dist-connector', { recursive: true });
await build({
  entryPoints: ['packages/connector/src/cli.ts'],
  outfile: 'dist-connector/controlslab-connector.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: false,
  legalComments: 'inline',
  // `ws` optionally uses native speedups; the pure-JS fallback is fine here.
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const out = readFileSync('dist-connector/controlslab-connector.mjs', 'utf8').replace(/^#!.*\n/, '');
writeFileSync('dist-connector/controlslab-connector.mjs', `#!/usr/bin/env node\n// ControlsLab connector — AGPL-3.0-only — https://github.com/Installation-04/controlslab\n${out}`);
// The web app ships the connector so learners can download it from the page (apps/web/public is copied into dist/).
mkdirSync('apps/web/public/downloads', { recursive: true });
copyFileSync('dist-connector/controlslab-connector.mjs', 'apps/web/public/downloads/controlslab-connector.mjs');
console.log('dist-connector/controlslab-connector.mjs');
