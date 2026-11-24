import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEODESIC_QUALITY_PRESETS } from '../src/rendering/quality/quality-settings.ts';

function extractBlock(source:string,marker:string):string{
 const markerIndex=source.indexOf(marker);
 assert.notEqual(markerIndex,-1,'missing source block: '+marker);
 const open=source.indexOf('{',markerIndex);
 let depth=0,quote='',escaped=false,lineComment=false,blockComment=false;
 for(let i=open;i<source.length;i++){
  const char=source[i],next=source[i+1];
  if(lineComment){if(char==='\n')lineComment=false;continue;}
  if(blockComment){if(char==='*'&&next==='/'){blockComment=false;i++;}continue;}
  if(quote){if(escaped){escaped=false;continue;}if(char==='\\'){escaped=true;continue;}if(char===quote)quote='';continue;}
  if(char==='/'&&next==='/'){lineComment=true;i++;continue;}
  if(char==='/'&&next==='*'){blockComment=true;i++;continue;}
  if(char==='"'||char==="'"){quote=char;continue;}
  if(char==='{')depth++;
  else if(char==='}'&&--depth===0)return source.slice(open,i+1);
 }
 assert.fail('unbalanced source block: '+marker);
}

test('planet render loop isolates WebGL programs and keeps the UV fallback conditional',async()=>{
 const source=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 const loop=extractBlock(source,'for(const body of bodies){\n   g.useProgram(this.bodyProgram);');
 assert.match(loop,/^\{\s*g\.useProgram\(this\.bodyProgram\);\s*const state=states\.get\(body\.id\);/);
 assert.match(loop,/if\(body\.id==='earth'&&this\.geodesicEarthRenderer&&this\.earthRenderMode!=='uv'\)/);
 assert.match(loop,/(?:pendingRenderer|activeRenderer)\.render\(frame\)/);
 assert.match(loop,/if\(!renderedGeodesicEarth\)\s*\{\s*(?:\/\/[^\n]*\s*)?g\.disable\(g\.CULL_FACE\);g\.disable\(g\.BLEND\);g\.depthMask\(true\);g\.activeTexture\(g\.TEXTURE0\);g\.bindTexture\(g\.TEXTURE_2D_ARRAY,null\);\s*g\.useProgram\(this\.bodyProgram\);this\.bindMesh\(mesh,l\);g\.drawElements\(g\.TRIANGLES,mesh\.count,g\.UNSIGNED_SHORT,0\);\s*\}/);
 const atmosphere=extractBlock(source,' drawAtmosphere(body,profile,p,radius,mesh,vp,eye,light,occluders){');
 const clouds=extractBlock(source,' drawClouds(body,layers,p,radius,mesh,vp,light,occluders,timeSeconds,baseModel){');
 assert.match(atmosphere,/g\.useProgram\(this\.atmosphereProgram\)/);
 assert.match(atmosphere,/this\.bindMesh\(mesh,l\);\s*g\.drawElements\(/);
 assert.match(clouds,/g\.useProgram\(this\.cloudProgram\)/);
 assert.match(clouds,/this\.bindMesh\(mesh,l\);\s*g\.drawElements\(/);
 const rings=await readFile(new URL('../src/rendering/rings/ring-renderer.ts',import.meta.url),'utf8');
 assert.match(rings,/g\.useProgram\(this\.program\)/);
 assert.match(rings,/g\.drawArrays\(g\.TRIANGLE_STRIP,0,this\.count\)/);
});

test('both published entry points gate application import behind the start screen',async()=>{
 const [root,lab,main]=await Promise.all([
  readFile(new URL('../index.html',import.meta.url),'utf8'),
  readFile(new URL('../lab/index.html',import.meta.url),'utf8'),
  readFile(new URL('../lab/main.ts',import.meta.url),'utf8')
 ]);
 for(const [name,page] of [['root',root],['lab',lab]] as const){
  assert.match(page,/id="start-screen"/,name+' start screen');
  assert.match(page,/id="start-simulation"/,name+' start button');
  assert.match(page,/class="loading-screen is-hidden"/,name+' hidden loading screen');
 }
 assert.match(main,/startButton\.addEventListener\('click',\(\)=>\{[\s\S]*?loading\.show\(\);[\s\S]*?void startApplication\(\);/);
 assert.match(main,/async function startApplication\(\):Promise<void>\{[\s\S]*?await loading\.nextFrame\(\);[\s\S]*?await import\('\.\/lab\.ts'\)/);
 assert.match(main,/startButton\.addEventListener\('click'/);
});


test('quality replacement keeps the ready Earth renderer visible while sharing its worker pool',async()=>{
 const source=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 const manager=await readFile(new URL('../src/rendering/geodesic/virtual-surface-manager.ts',import.meta.url),'utf8');
 assert.match(source,/if\(active\?\.isReady\)this\.geodesicPendingRenderer=replacement/);
 assert.match(source,/if\(pendingRenderer\.isReady\)[\s\S]*?activeRenderer\.dispose\(\)/);
 assert.match(source,/workerPool:this\.geodesicWorkerPool/);
 assert.match(manager,/this\.ownsPool=!options\.pool/);
 assert.match(manager,/this\.abortController\.abort\(\)/);
});

test('all geodesic quality presets can hold twenty pages within both cache budgets',()=>{
 for(const [level,settings] of Object.entries(GEODESIC_QUALITY_PRESETS)){
  const pageBytes=(settings.pageResolution+4)**2*13;
  assert.ok(settings.gpuBudgetBytes>=pageBytes*20,level+' GPU cache must fit twenty root pages');
  assert.ok(settings.cpuBudgetBytes>=pageBytes*20,level+' CPU cache must fit twenty generated root pages');
  assert.ok(settings.workerCount>=1,level+' must have at least one worker');
  assert.ok(settings.uploadsPerFrame>=1,level+' must throttle uploads to a positive frame budget');
  assert.ok(settings.meshResolution>=2&&settings.meshResolution%2===0,level+' mesh resolution must be even');
 }
});


test('geodesic upload failures release GPU resources and stop retrying the same page every frame',async()=>{
 const renderer=await readFile(new URL('../src/rendering/geodesic/geodesic-planet-renderer.ts',import.meta.url),'utf8');
 assert.match(renderer,/if\(!this\.upload\(page\)\)\{this\.failRenderer/);
 assert.match(renderer,/private failRenderer\(error:unknown,taskKind='renderer',taskKey='renderer'\)[\s\S]*?this\.firstFailureValue[\s\S]*?this\.manager\.dispose\(\);this\.disposeGpuOnly\(\)/);
 assert.match(renderer,/finally\{this\.lastPinnedPages=pinned\.length/);
});

test('surface worker pool recovers from partial startup and rejects queued tasks if no worker survives',async()=>{
 const pool=await readFile(new URL('../src/rendering/geodesic/surface-worker-pool.ts',import.meta.url),'utf8');
 assert.match(pool,/slot\.ready=true;this\.startupError=null;this\.pump\(\)/);
 assert.match(pool,/if\(this\.slots\.length===0\)this\.rejectQueuedWithoutWorkers\(\)/);
 assert.match(pool,/if\(this\.slots\.length===0\)return Promise\.reject/);
 assert.match(pool,/private rejectQueuedWithoutWorkers\(\):void/);
});
