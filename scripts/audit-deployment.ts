import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),dist=join(root,'dist');
const vite=await readFile(join(root,'vite.config.ts'),'utf8');
const workflow=await readFile(join(root,'.github/workflows/pages.yml'),'utf8');
if(!/base:\s*['"]\.\/['"]/.test(vite))throw new Error('Vite base must be relative for GitHub Pages project paths.');
if(!workflow.includes('branches: [test]')||!workflow.includes('npm run audit')||!workflow.includes('actions/upload-pages-artifact')||!workflow.includes('actions/deploy-pages')||!workflow.includes('needs: build'))throw new Error('Pages workflow is missing its quality gate or build dependency.');
async function isFile(path:string){try{return(await stat(path)).isFile();}catch{return false;}}
for(const page of ['index.html','lab/index.html']){
 const html=await readFile(join(dist,page),'utf8'),base=dirname(join(dist,page));
 const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
 if(!scripts.length)throw new Error(page+': no production JavaScript entry point.');
 for(const ref of scripts){
  if(/\.tsx?(?:$|[?#])/i.test(ref)||!/\.m?js(?:$|[?#])/i.test(ref))throw new Error(page+': invalid compiled script reference '+ref);
  if(!await isFile(resolve(base,decodeURIComponent(ref.split(/[?#]/,1)[0]))))throw new Error(page+': missing script '+ref);
 }
 const styles=[...html.matchAll(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
 for(const ref of styles){
  if(!/\.css(?:$|[?#])/i.test(ref))throw new Error(page+': invalid stylesheet reference '+ref);
  if(!await isFile(resolve(base,decodeURIComponent(ref.split(/[?#]/,1)[0]))))throw new Error(page+': missing stylesheet '+ref);
 }
}
if(!await isFile(join(dist,'.nojekyll')))throw new Error('dist/.nojekyll is missing.');
async function checkNoTs(dir:string):Promise<void>{
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())await checkNoTs(path);
  else if(/\.tsx?$/i.test(entry.name))throw new Error('Raw TypeScript emitted to dist: '+path.slice(dist.length+1));
 }
}
await checkNoTs(dist);
process.stdout.write('DEPLOYMENT AUDIT PASSED: both pages, JS/CSS references, .nojekyll, and compiled-only output verified.\n');
