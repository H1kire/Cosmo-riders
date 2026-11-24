import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('root and lab entries paint the loading overlay before application modules',async()=>{
 const root=await readFile(new URL('../index.html',import.meta.url),'utf8');
 const lab=await readFile(new URL('../lab/index.html',import.meta.url),'utf8');
 for(const html of [root,lab]){
  const overlay=html.indexOf('id="loading-screen"');
  const entry=html.indexOf('type="module" src=');
  assert.ok(overlay>=0&&entry>overlay);
  assert.ok(html.includes('id="loading-progress"'));
  assert.ok(html.includes('id="loading-retry"'));
 }
});
test('bootstrap dynamically imports the heavy application after yielding a frame',async()=>{
 const main=await readFile(new URL('../lab/main.ts',import.meta.url),'utf8');
 assert.ok(main.includes("await loading.nextFrame()"));
 assert.ok(main.includes("await import('./lab.ts')"));
 assert.ok(!main.includes("import './lab.ts'"));
});
test('loading progress is driven by completed named stages, not a timer counter',async()=>{
 const [loader,docs]=await Promise.all([
  readFile(new URL('../lab/loading-screen.ts',import.meta.url),'utf8'),
  readFile(new URL('../docs/LOADING_SYSTEM.md',import.meta.url),'utf8')
 ]);
 assert.ok(loader.includes('this.completed.add(id)'));
 assert.ok(loader.includes('STAGES.reduce'));
 assert.ok(loader.includes("id==='application'"));
 assert.ok(!loader.includes('setInterval'));
 assert.ok(docs.includes('does not by itself prove that long main-thread stalls have been eliminated'));
});
