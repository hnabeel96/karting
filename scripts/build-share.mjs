// Packs the client into dist-share/ as a flat folder that any static host can serve
// (no access to ../shared needed). Used to publish a playable link.
//   node scripts/build-share.mjs

import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-share');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(path.join(ROOT, 'client/src'), path.join(OUT, 'src'), { recursive: true });
await cp(path.join(ROOT, 'shared'), path.join(OUT, 'shared'), { recursive: true });
await cp(path.join(ROOT, 'client/models'), path.join(OUT, 'models'), { recursive: true });

let html = await readFile(path.join(ROOT, 'client/index.html'), 'utf8');
html = html
  .replace('"@shared/": "../shared/"', '"@shared/": "./shared/"')
  // hosted copies load three.js from a CDN; local wifi play uses the vendored copy
  .replace('"./vendor/three.module.min.js"', '"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js"')
  .replace('"./vendor/addons/"', '"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"');

// The host wraps the page in its own document, so emit only the inner parts:
// head content (minus charset/viewport) followed by body content.
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/, '')
  .replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
await writeFile(path.join(OUT, 'index.html'), head.trim() + '\n' + body.trim() + '\n');
console.log('wrote', path.relative(ROOT, OUT));
