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

test('planet atmosphere, clouds, rings and orbits are submitted to WebGPU without duplicate GLSL passes',async()=>{
 const [source,backend]=await Promise.all([
  readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8'),
  readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8')
 ]);
 assert.match(source,/webgpuDraw\.atmosphere=/);
 assert.match(source,/webgpuDraw\.clouds=/);
 assert.match(source,/this\.webgpuRings\.push/);
 assert.match(source,/this\.webgpuOrbits\.push/);
 assert.match(backend,/const drawShell =/);
 assert.match(backend,/const RING_SHADER/);
 assert.match(backend,/ringPipeline/);
 assert.match(backend,/orbitPipeline/);
 assert.doesNotMatch(source,/drawAtmosphere\(/);
 assert.doesNotMatch(source,/drawClouds\(/);
 assert.doesNotMatch(source,/RingRenderer|LINE_VERTEX|LINE_FRAGMENT/);
 assert.doesNotMatch(source,/atmosphereProgram|cloudProgram|lineProgram/);
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


test('Solar3DView initializes directly on WebGPU without WebGL resources',async()=>{
 const source=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 assert.match(source,/readonly ready:Promise<void>/);
 assert.match(source,/this\.ready=this\.initialize\(\)/);
 assert.match(source,/const webgpuReady=await this\.initializeWebGPUBackend\(\)/);
 assert.match(source,/this\.webgpuBackend\.render\(/);
 assert.match(source,/postProcessing:\{bloom:/);
 assert.match(source,/PerformanceObserver/);
 assert.doesNotMatch(source,/getContext\('webgl2'\)/);
 assert.doesNotMatch(source,/makeSphere\(|makeProgram\(|GeodesicPlanetRenderer/);
 assert.doesNotMatch(source,/g\.drawElements|g\.useProgram/);
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
