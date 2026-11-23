import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['node_modules', 'dist', '.git']);
async function walk(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignored.has(entry.name)) output.push(...await walk(join(directory, entry.name)));
    else if (entry.isFile() && ['.html', '.css'].includes(extname(entry.name).toLowerCase())) output.push(join(directory, entry.name));
  }
  return output;
}
const sources = await walk(root);
let failures = 0;
function localPath(value: string): string | null {
  const clean = value.trim().split(/[?#]/, 1)[0];
  if (!clean || /^(?:[a-z]+:|\/\/|#|data:)/i.test(clean)) return null;
  try { return decodeURIComponent(clean); } catch { return clean; }
}
async function exists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
for (const file of sources) {
  const content = await readFile(file, 'utf8');
  const references: string[] = [];
  for (const match of content.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) references.push(match[1]);
  if (extname(file).toLowerCase() === '.css') {
    for (const match of content.matchAll(/url\(\s*['"]?([^)'"]+)['"]?\s*\)/gi)) references.push(match[1]);
  }
  for (const raw of references) {
    const relative = localPath(raw);
    if (relative === null) continue;
    const candidate = resolve(dirname(file), relative);
    if (await exists(candidate)) continue;
    const publicCandidate = resolve(root, 'public', relative.replace(/^[/\\]+/, ''));
    if (await exists(publicCandidate)) continue;
    failures++;
    process.stderr.write('FAIL ' + file.slice(root.length + 1) + ' -> ' + raw + '\n');
  }
}
if (failures) {
  process.stderr.write('ASSET AUDIT FAILED: ' + failures + ' local HTML/CSS resource references are missing.\n');
  process.exitCode = 1;
} else process.stdout.write('ASSET AUDIT PASSED: ' + sources.length + ' HTML/CSS files scanned; all local resource references resolve.\n');
