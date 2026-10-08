import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'naryadai-router-'));
try {
  await build({
    entryPoints: ['tests/openrouter_regression.mjs'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(dir, 'check.mjs'),
    plugins: [
      {
        name: 'fixture-workers-env',
        setup(builder) {
          builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
            path: 'env',
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const env = {};',
            loader: 'js',
          }));
        },
      },
    ],
  });
  execFileSync(process.execPath, [join(dir, 'check.mjs')], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
