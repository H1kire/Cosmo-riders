import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const extensions=['.ts','.tsx','.js','.jsx','.mjs','.cjs'];
const ignored=new Set(['node_modules','dist','.git']);
async function walk(dir:string):Promise<string[]>{
 const found:string[]=[];
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory()&&!ignored.has(entry.name))found.push(...await walk(path));
  else if(entry.isFile()&&extensions.includes(extname(entry.name)))found.push(path);
 }
 return found;
}
const files=await walk(root),known=new Set(files.map(path=>resolve(path)));
const candidates=(target:string)=>extname(target)?[target]:extensions.map(ext=>target+ext).concat(['index.ts','index.tsx','index.js','index.jsx'].map(name=>join(target,name)));
let failures=0;
for(const file of files){
 const source=await readFile(file,'utf8');
 const patterns=[/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,/new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g];
 for(const pattern of patterns)for(const match of source.matchAll(pattern)){
  const spec=match[1];if(!spec.startsWith('.'))continue;
  const target=resolve(dirname(file),spec.split(/[?#]/,1)[0]);
  if(!candidates(target).some(path=>known.has(resolve(path)))){
   failures++;process.stderr.write('FAIL '+file.slice(root.length+1)+' -> '+spec+'\n');
  }
 }
}
if(failures){process.stderr.write('IMPORT AUDIT FAILED: '+failures+' unresolved local references.\n');process.exitCode=1;}
else process.stdout.write('IMPORT AUDIT PASSED: '+files.length+' source files scanned; local imports and Worker URLs resolve with exact casing.\n');
