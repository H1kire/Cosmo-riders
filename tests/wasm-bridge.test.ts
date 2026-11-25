import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { generate_surface_tile } from '../src/wasm/pkg/cosmo_core.js';
import { generateSurfaceTile } from '../src/rendering/geodesic/surface-tile.ts';
import { createGeologicalProfile } from '../src/rendering/geodesic/surface-profile.ts';
import { tileId } from '../src/rendering/geodesic/icosphere.ts';

const read=(path:string)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Rust exports the numerical and geodesic worker API',async()=>{
 const wasm=await read('crates/cosmo-core/src/wasm.rs');
 for(const symbol of ['propagate_kepler','state_to_orbital_elements','orbital_elements_to_state','generate_surface_tile','build_geodesic_tile_mesh'])assert.ok(wasm.includes('fn '+symbol+'('),symbol+' export is missing');
});

test('active geodesic worker delegates tile and mesh generation to WASM',async()=>{
 const worker=await read('src/rendering/geodesic/surface-tile-worker.ts');
 assert.match(worker,/import init,\s*\{\s*build_geodesic_tile_mesh,\s*generate_surface_tile\s*\}/);
 assert.match(worker,/await ensureWasm\(\)/);
 assert.match(worker,/generate_surface_tile\(/);
 assert.match(worker,/build_geodesic_tile_mesh\(/);
 assert.doesNotMatch(worker,/import \{ generateSurfaceTile \}/);
});

test('Rust surface contract preserves metre heights and all five channels',async()=>{
 const rust=await read('crates/cosmo-core/src/surface.rs');
 const bridge=await read('crates/cosmo-core/src/wasm.rs');
 assert.match(rust,/pub height:Vec<f32>/);
 assert.match(rust,/height_fraction\(s\.height\)\*p\.mean_radius_m/);
 for(const channel of ['albedo','normal','height','roughness','materialId'])assert.ok(bridge.includes('"'+channel+'"'),channel+' WASM channel is missing');
});


let wasmReady:Promise<void>|undefined;
async function initializeWasm():Promise<void>{
 if(!wasmReady)wasmReady=readFile(new URL('../src/wasm/pkg/cosmo_core_bg.wasm',import.meta.url))
  .then(bytes=>init(new Uint8Array(bytes)).then(()=>undefined));
 await wasmReady;
}

test('Rust/WASM surface pages match the retained TypeScript reference channels',async()=>{
 await initializeWasm();
 const bodies=[
  {id:'earth',massKg:5.9722e24,meanRadiusM:6371008.4,surfaceSeed:101,surface:{temperatureK:288,pressurePa:101325,waterFraction:.71,iceFraction:.025,ironFraction:.32,tectonicActivity:.8,volcanicActivity:.32,erosion:.78,impactAge:.18},rotationPeriodSeconds:86164},
  {id:'saturn',massKg:5.6834e26,meanRadiusM:58232000,surfaceSeed:77,surface:{temperatureK:134,pressurePa:1e5},rotationPeriodSeconds:38362}
 ];
 for(const body of bodies){
  const profile=createGeologicalProfile(body as never);
  const request={planetId:body.id,seed:profile.seed,tile:tileId(body.id==='earth'?0:4,body.id==='earth'?'2':''),resolution:body.id==='earth'?16:8,gutter:2,profile};
  const expected=generateSurfaceTile(request);
  const actual=generate_surface_tile(request.tile.face,request.tile.path,request.resolution,request.gutter,JSON.stringify(profile)) as {
   albedo:Uint8Array;normal:Uint8Array;height:Float32Array;roughness:Uint8Array;materialId:Uint8Array;
  };
  assert.deepEqual(actual.albedo,expected.albedo,body.id+' albedo parity');
  assert.deepEqual(actual.normal,expected.normal,body.id+' normal parity');
  assert.deepEqual(actual.height,expected.height,body.id+' height parity');
  assert.deepEqual(actual.roughness,expected.roughness,body.id+' roughness parity');
  assert.deepEqual(actual.materialId,expected.materialId,body.id+' material parity');
 }
});
