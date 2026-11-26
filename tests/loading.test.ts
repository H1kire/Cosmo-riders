import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file=(...parts:string[])=>new URL(parts.join('/'),import.meta.url);

test('root and lab entries paint the loading overlay before application modules',async()=>{
 const root=await readFile(file('..','index.html'),'utf8');
 const lab=await readFile(file('..','lab','index.html'),'utf8');
 for(const html of [root,lab]){
  const overlay=html.indexOf('id="loading-screen"');
  const entry=html.indexOf('type="module" src=');
  assert.ok(overlay>=0&&entry>overlay);
  assert.ok(html.includes('id="loading-progress"'));
  assert.ok(html.includes('id="loading-retry"'));
 }
});
test('bootstrap dynamically imports the heavy application after yielding a frame',async()=>{
 const main=await readFile(file('..','lab','main.ts'),'utf8');
 assert.ok(main.includes("await loading.nextFrame()"));
 assert.ok(main.includes(["await import('",'.','/lab.ts',"')"].join('')));
 assert.ok(!main.includes(["import '",'.','/lab.ts',"'"].join('')));
 const lab=await readFile(file('..','lab','lab.ts'),'utf8');
 assert.ok(lab.indexOf('await new Promise<void>(resolve=>requestAnimationFrame')<lab.indexOf('new Solar3DView('));
 assert.ok(lab.includes("reportLoading('first-frame',true)"));
 assert.ok(main.includes("detail?.id==='first-frame'&&detail.complete"));
});
test('loading progress is driven by completed named stages, not a timer counter',async()=>{
 const [loader,docs]=await Promise.all([
  readFile(file('..','lab','loading-screen.ts'),'utf8'),
  readFile(file('..','docs','LOADING_SYSTEM.md'),'utf8')
 ]);
 assert.ok(loader.includes('this.completed.add(id)'));
  assert.ok(loader.includes("this.completed.add('first-frame')"));
  assert.ok(!loader.includes('new Set(STAGES.map'));
 assert.ok(loader.includes('STAGES.reduce'));
 assert.ok(loader.includes("id==='application'||id==='surface'||id==='gpu'"));
 for(const stage of ['webgl','solar-system','renderer','surface','gpu'])assert.ok(loader.includes("id:'"+stage+"'"));
 assert.ok(!loader.includes('setInterval'));
 assert.ok(docs.includes('first Solar System frame is therefore independent'));
  assert.ok(docs.includes('moved off the main thread'));
});


test('WebGPU startup is non-blocking and scene setup failures release the loading gate',async()=>{
 const [view,main,lab]=await Promise.all([
  readFile(file('..','src','presentation','solar-3d.ts'),'utf8'),
  readFile(file('..','lab','main.ts'),'utf8'),
  readFile(file('..','lab','lab.ts'),'utf8')
 ]);
 assert.ok(view.includes("void this.initializeWebGPUBackend()"));
 assert.ok(!view.includes("await this.initializeWebGPUBackend()"));
 assert.ok(main.includes("'cosmo-loading-failed'"));
 assert.ok(lab.includes("'cosmo-loading-failed'"));
});
