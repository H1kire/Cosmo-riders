import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const root = resolve('dist');
const pages = ['index.html', 'lab/index.html'];
const scripts = [];
for (const page of pages) {
  const html = await readFile(join(root, page), 'utf8');
  const refs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  if (!refs.length) throw new Error(page + ': no compiled JavaScript entry point found.');
  if (refs.some(ref => /\.tsx?(?:$|[?#])/i.test(ref))) {
    throw new Error(page + ': raw TypeScript reference remains in built HTML: ' + refs.join(', '));
  }
  for (const ref of refs) {
    const file = resolve(dirname(join(root, page)), decodeURIComponent(ref.split(/[?#]/, 1)[0]));
    try { await stat(file); }
    catch { throw new Error(page + ': compiled script does not exist: ' + ref); }
    scripts.push(file);
  }
  const icon = html.match(/<link\b[^>]*\brel=["']icon["'][^>]*\bhref=["']([^"']+)["']/i)
    ?? html.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']icon["']/i);
  if (!icon) throw new Error(page + ': favicon link is missing.');
  const iconFile = resolve(dirname(join(root, page)), decodeURIComponent(icon[1].split(/[?#]/, 1)[0]));
  try { await stat(iconFile); }
  catch { throw new Error(page + ': favicon file does not exist: ' + icon[1]); }
}
const assetFiles = await readdir(join(root, 'assets'));
const jsFiles = assetFiles.filter(name => name.endsWith('.js'));
const wasmFiles = assetFiles.filter(name => name.endsWith('.wasm'));
if (!wasmFiles.length) throw new Error('No compiled WebAssembly assets were emitted.');
for (const name of wasmFiles) {
  const bytes = await readFile(join(root, 'assets', name));
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error('Invalid WebAssembly asset: ' + name);
}
await writeFile(join(root, 'wasm-assets.json'), JSON.stringify(wasmFiles.map(name => 'assets/' + name), null, 2) + '\n');
if (!jsFiles.length) throw new Error('No JavaScript bundles were emitted.');
const combined = (await Promise.all(jsFiles.map(name => readFile(join(root, 'assets', name), 'utf8')))).join('\n');
for (const token of ['solar-view', 'graphics-preset']) {
  if (!combined.includes(token)) throw new Error('Compiled bundles are missing expected application code: ' + token);
}
process.stdout.write('DIST VERIFIED: both pages reference compiled JavaScript, all script/icon files exist, WASM assets are valid and listed for MIME verification, and no raw .ts modules are published.\n');
