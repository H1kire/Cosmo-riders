import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const vite = await readFile(join(root, 'vite.config.ts'), 'utf8');
const workflow = await readFile(join(root, '.github/workflows/pages.yml'), 'utf8');
if (!/base:\s*['"]\.\/['"]/.test(vite)) throw new Error('Vite base must remain relative for GitHub Pages project paths.');
if (!workflow.includes('branches: [test]') || !workflow.includes('npm run audit') ||
    !workflow.includes('actions/upload-pages-artifact') || !workflow.includes('actions/deploy-pages') ||
    !workflow.includes('needs: build')) throw new Error('GitHub Pages workflow is missing a required quality gate or deployment dependency.');
async function isFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
for (const page of ['index.html', 'lab/index.html']) {
  const html = await readFile(join(dist, page), 'utf8');
  const base = dirname(join(dist, page));
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  if (!scripts.length) throw new Error(page + ': no production JavaScript entry point.');
  for (const source of scripts) {
    if (/\.tsx?(?:$|[?#])/i.test(source)) throw new Error(page + ': raw TypeScript module reference: ' + source);
    if (!/\.m?js(?:$|[?#])/i.test(source)) throw new Error(page + ': script does not have a JavaScript extension: ' + source);
    if (!await isFile(resolve(base, decodeURIComponent(source.split(/[?#]/, 1)[0])))) throw new Error(page + ': missing script ' + source);
  }
  const styles = [...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  for (const source of styles) {
    if (!/\.css(?:$|[?#])/i.test(source)) throw new Error(page + ': stylesheet does not have a CSS extension: ' + source);
    if (!await isFile(resolve(base, decodeURIComponent(source.split(/[?#]/, 1)[0])))) throw new Error(page + ': missing stylesheet ' + source);
  }
}
const nojekyll = await isFile(join(dist, '.nojekyll'));
if (!nojekyll) throw new Error('dist/.nojekyll is missing; GitHub Pages may process asset paths through Jekyll.');
async function assertNoRawTypeScript(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await assertNoRawTypeScript(path);
    else if (/\.tsx?$/i.test(entry.name)) throw new Error('Raw TypeScript file was emitted to dist: ' + path.slice(dist.length + 1));
  }
}
await assertNoRawTypeScript(dist);
process.stdout.write('DEPLOYMENT AUDIT PASSED: root and /lab/ pages reference compiled JS/CSS, no raw TS is published, and .nojekyll is present.\n');
