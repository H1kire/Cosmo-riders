import { access, readFile, stat } from 'node:fs/promises';

const pkg=new URL('../src/wasm/pkg/',import.meta.url);
for(const name of ['cosmo_core.js','cosmo_core.d.ts','cosmo_core_bg.wasm'])await access(new URL(name,pkg));
const wasmPath=new URL('cosmo_core_bg.wasm',pkg);
const wasm=await readFile(wasmPath);
if(wasm.length<8||wasm[0]!==0x00||wasm[1]!==0x61||wasm[2]!==0x73||wasm[3]!==0x6d)throw new Error('Generated browser module is not a valid WebAssembly binary.');
const worker=await readFile(new URL('../src/rendering/geodesic/surface-tile-worker.ts',import.meta.url),'utf8');
const bindings=await readFile(new URL('cosmo_core.d.ts',pkg),'utf8');
for(const symbol of ['generate_surface_tile','build_geodesic_tile_mesh'])if(!bindings.includes(symbol))throw new Error('WASM binding is missing '+symbol+'.');
if(!worker.includes("from '../../wasm/pkg/cosmo_core.js'")||!worker.includes('await ensureWasm()'))throw new Error('Geodesic worker is not initializing the generated WASM package.');
if(!worker.includes('JSON.stringify(task.request.profile)'))throw new Error('Surface worker is not forwarding the compact generation profile to Rust.');
if(!worker.includes('scope.postMessage({id:task.id,tile},transferables(arrays))'))throw new Error('Surface worker must transfer generated binary channel buffers.');
const bytes=(await stat(wasmPath)).size;
process.stdout.write('WASM AUDIT PASSED: wasm-bindgen package present ('+bytes+' bytes); surface and mesh exports are connected to the isolated worker.\n');
