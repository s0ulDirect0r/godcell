import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: resolve(__dirname, '../dist/server/index.js'),
  sourcemap: true,
  // Don't bundle these - they use worker threads or have bundling issues
  external: [
    'pino',            // Uses worker threads for transports
    'pino-pretty',     // Pino's pretty printer
    'pino-roll',       // File rotation transport
    'thread-stream',   // Pino's thread streaming
  ],
  // Resolve #shared alias (Node.js subpath imports)
  alias: {
    '#shared': resolve(__dirname, '../shared'),
  },
  // Banner to handle __dirname in ESM
  banner: {
    js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
    `.trim(),
  },
});

console.log('Server build complete: dist/server/index.js');
