import { readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const ignored = new Set(['node_modules', 'dist', '.git', '.github']);
async function walk(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignored.has(entry.name)) output.push(...await walk(join(directory, entry.name)));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) output.push(join(directory, entry.name));
  }
  return output;
}
const files = await walk(root);
const known = new Set(files.map(path => resolve(path)));
const candidatesFor = (target: string): string[] => {
  if (extname(target)) return [target];
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].map(extension => target + extension)
    .concat(['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map(name => join(target, name)));
};
let failures = 0;
for (const file of files) {
  const source = await (await import('node:fs/promises')).readFile(file, 'utf8');
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier.split(/[?#]/, 1)[0]);
      if (!candidatesFor(target).some(candidate => known.has(resolve(candidate)))) {
        failures++;
        process.stderr.write('FAIL ' + file.slice(root.length + 1) + ' -> ' + specifier + '\n');
      }
    }
  }
}
if (failures) {
  process.stderr.write('IMPORT AUDIT FAILED: ' + failures + ' unresolved or incorrectly-cased local references.\n');
  process.exitCode = 1;
} else process.stdout.write('IMPORT AUDIT PASSED: ' + files.length + ' source files scanned; static imports and Worker URLs resolve with exact path casing.\n');
