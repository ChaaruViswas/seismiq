// Bundle the CLI into a single dependency-free file that runs on any Node 20+.
import { chmodSync } from 'node:fs';
import { build } from 'esbuild';

await build({
  entryPoints: ['cli/seismiq.ts'],
  outfile: 'dist-cli/seismiq.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'info',
});
chmodSync('dist-cli/seismiq.mjs', 0o755);
