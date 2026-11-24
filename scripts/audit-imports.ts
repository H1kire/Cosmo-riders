import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const extensions=['.ts','.tsx','.js','.jsx','.mjs','.cjs'];
const ignored=new Set(['node_modules','dist','.git','scripts']);
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
const graph=new Map<string,Set<string>>();
const candidates=(target:string)=>extname(target)?[target]:extensions.map(ext=>target+ext).concat(['index.ts','index.tsx','index.js','index.jsx'].map(name=>join(target,name)));
let failures=0;
for(const file of files){
 graph.set(file,new Set());
 const source=await readFile(file,'utf8');
 const patterns=[/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g,/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,/\bnew\s+(?:Worker|SharedWorker)\s*\(\s*new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g];
 for(const pattern of patterns)for(const match of source.matchAll(pattern)){
  const spec=match[1];if(!spec.startsWith('.'))continue;
  const target=resolve(dirname(file),spec.split(/[?#]/,1)[0]);
  const resolved=candidates(target).map(path=>resolve(path)).find(path=>known.has(path));
  if(!resolved){failures++;process.stderr.write('FAIL '+file.slice(root.length+1)+' -> '+spec+'\n');}
  else graph.get(file)!.add(resolved);
 }
}
const visited=new Set<string>(),active=new Set<string>(),stack:string[]=[];
const cycles=new Set<string>();
function visit(file:string):void{
 if(active.has(file)){
  const start=stack.indexOf(file),cycle=stack.slice(start).concat(file);
  cycles.add(cycle.map(path=>path.slice(root.length+1)).join(' -> '));
  return;
 }
 if(visited.has(file))return;
 visited.add(file);active.add(file);stack.push(file);
 for(const dependency of graph.get(file)??[])visit(dependency);
 stack.pop();active.delete(file);
}
for(const file of graph.keys())visit(file);
for(const cycle of cycles){failures++;process.stderr.write('CYCLE '+cycle+'\n');}
if(failures){process.stderr.write('IMPORT AUDIT FAILED: '+failures+' unresolved references or dependency cycles.\n');process.exitCode=1;}
else process.stdout.write('IMPORT AUDIT PASSED: '+files.length+' source files scanned; imports and Worker URLs resolve and the dependency graph is acyclic.\n');
