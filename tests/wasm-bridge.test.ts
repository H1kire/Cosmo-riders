import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
