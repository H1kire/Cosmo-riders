import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { generate_surface_tile } from '../src/wasm/pkg/cosmo_core.js';
import { generateSurfaceTile } from '../src/rendering/geodesic/surface-tile.ts';
import { createGeologicalProfile } from '../src/rendering/geodesic/surface-profile.ts';
import { tileId } from '../src/rendering/geodesic/icosphere.ts';
import { createSolarSystemBodyCatalog } from '../src/physics/solar-system.ts';
import { create_physics_world, hohmann_transfer, plane_change_delta_v, orbital_period } from '../src/wasm/pkg/cosmo_core.js';

const read=(path:string)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('Rust exports the numerical and geodesic worker API',async()=>{
 const wasm=await read('crates/cosmo-core/src/wasm.rs');
 for(const symbol of ['propagate_kepler','state_to_orbital_elements','orbital_elements_to_state','generate_surface_tile','build_geodesic_tile_mesh'])assert.ok(wasm.includes('fn '+symbol+'('),symbol+' export is missing');
});

test('active geodesic worker delegates tile and mesh generation to WASM',async()=>{
 const worker=await read('src/rendering/geodesic/surface-tile-worker.ts');
 assert.match(worker,/import init,\s*\{(?=[^}]*\bbuild_geodesic_tile_mesh\b)(?=[^}]*\bgenerate_surface_tile\b)[^}]*\}/);
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


test('Rust WASM exports stitching and point-mass diagnostics',async()=>{
 const wasm=await read('crates/cosmo-core/src/wasm.rs');
 for(const symbol of ['build_geodesic_stitch_indices','gravitational_acceleration','specific_orbital_energy'])assert.ok(wasm.includes('fn '+symbol+'('),symbol+' export is missing');
 const geometry=await read('crates/cosmo-core/src/geometry.rs');
 assert.ok(geometry.includes('pub fn build_stitch_indices'));
});


test('geodesic mesh worker requests Rust-generated stitch indices with an explicit edge mask',async()=>{
 const [worker,pool]=await Promise.all([read('src/rendering/geodesic/surface-tile-worker.ts'),read('src/rendering/geodesic/surface-worker-pool.ts')]);
 assert.match(worker,/build_geodesic_stitch_indices\(task\.resolution,task\.coarseEdgeMask\)/);
 assert.match(pool,/coarseEdgeMask=0/);
 assert.match(pool,/radiusM\+':'\+coarseEdgeMask/);
});

test('Rust PhysicsWorld WASM owns the canonical 50-body J2000 catalogue',async()=>{
 await initializeWasm();const catalog=createSolarSystemBodyCatalog();assert.equal(catalog.length,50);
 const world=create_physics_world(JSON.stringify(catalog),JSON.stringify({fixedStepSeconds:60,maxSubSteps:2000}));
 const snapshot=world.get_physics_snapshot() as {bodyIds:string[];bodyStates:Float64Array;simulationTimeSeconds:number};
 assert.equal(snapshot.bodyIds.length,50);assert.equal(snapshot.simulationTimeSeconds,0);assert.equal(snapshot.bodyStates.length,300);
 const day=world.get_body_states_at(86400);assert.equal(day.length,300);assert.ok(Array.from(day).every(Number.isFinite));
 world.dispose_physics_world();assert.throws(()=>world.get_physics_snapshot(),/disposed/i);
});
test('Rust WASM owns powered burns, Hohmann transfers and orbital periods',async()=>{
 await initializeWasm();
 const world=create_physics_world(JSON.stringify(createSolarSystemBodyCatalog()),JSON.stringify({fixedStepSeconds:60,maxSubSteps:2000}));
 const snapshot=world.get_physics_snapshot() as {bodyIds:string[];bodyStates:Float64Array};
 const index=snapshot.bodyIds.indexOf('earth'),o=index*6;
 world.add_vessel(JSON.stringify({id:'wasm-probe',primaryBodyId:'earth',position:[snapshot.bodyStates[o]+7000000,snapshot.bodyStates[o+1],snapshot.bodyStates[o+2]],velocity:[snapshot.bodyStates[o+3],snapshot.bodyStates[o+4]+7500,snapshot.bodyStates[o+5]],massKg:1000}));
 const burn=JSON.parse(world.apply_idealized_burn('wasm-probe',new Float64Array([0,1,0]),100,20000,18000,300,0,101325,700));
 assert.ok(burn.propellantUsedKg>0);assert.ok(JSON.parse(world.get_vessel_state('wasm-probe')).massKg<1000);
 const transfer=JSON.parse(hohmann_transfer(1.32712440018e20,149597870700,227939200000));
 assert.ok(transfer.departureDeltaVMS>0&&transfer.arrivalDeltaVMS>0);
 assert.ok(orbital_period(149597870700,1.32712440018e20)>0);assert.ok(plane_change_delta_v(7500,Math.PI/2)>0);
 world.dispose_physics_world();
});
test('dedicated physics worker delegates interpolation and simulation to its single WASM handle',async()=>{
 const [worker,bridge,client,protocol,core]=await Promise.all([read('src/wasm/physics/physics-worker.ts'),read('src/wasm/physics/physics-bridge.ts'),read('src/wasm/physics/physics-world-client.ts'),read('src/wasm/physics/physics-protocol.ts'),read('crates/cosmo-core/src/physics_world.rs')]);
 assert.match(worker,/create_physics_world\(/);assert.match(worker,/get_body_states_at\(renderTime\)/);assert.match(worker,/get_vessel_state_at\(id,renderTime,renderBodyStates\)/);
 assert.match(worker,/apply_idealized_burn\(/);assert.match(bridge,/new Worker\(new URL\('\.\/physics-worker\.ts'/);assert.match(client,/result\.renderBodyStates/);
 assert.match(protocol,/vesselPrimaryIds/);assert.match(core,/pub fn advance\(/);assert.match(core,/pub fn apply_idealized_burn\(/);
});
