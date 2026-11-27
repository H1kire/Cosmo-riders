import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import init, { generate_surface_tile } from '../src/wasm/pkg/cosmo_core.js';
import { generateSurfaceTile } from '../src/rendering/geodesic/surface-tile.ts';
import { createGeologicalProfile } from '../src/rendering/geodesic/surface-profile.ts';
import { tileId } from '../src/rendering/geodesic/icosphere.ts';
import { createSolarSystemBodyCatalog, createSolarSystemWorld, SOLAR_SYSTEM_DATA } from '../src/physics/solar-system.ts';
import { executeIdealizedBurn } from '../src/physics/propulsion.ts';
import { create_physics_world, hohmann_transfer, plane_change_delta_v, orbital_period, propagate_kepler, conic_elements_to_state, state_to_orbital_elements, build_geodesic_stitch_indices, thrust_to_weight_ratio } from '../src/wasm/pkg/cosmo_core.js';

const read=(path:string)=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('PhysicsBridge rejects pending work on Worker errors and message deserialization failures',async()=>{
 const bridge=await read('src/wasm/physics/physics-bridge.ts');
 assert.match(bridge,/worker\.onerror=/);
 assert.match(bridge,/worker\.onmessageerror=/);
 assert.match(bridge,/this\.failPending\(/);
 assert.match(bridge,/try\{this\.worker\.postMessage/);
 assert.match(bridge,/this\.pending\.delete\(id\)/);
});

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
 const catalog=createSolarSystemBodyCatalog() as Array<{id:string;[key:string]:unknown}>;
 const europa=catalog.find(body=>body.id==='europa');
 assert.ok(europa,'Europa must be present in the simulation catalogue');
 const bodies=[
  {...SOLAR_SYSTEM_DATA.earth,surfaceSeed:101},
  {...europa,surfaceSeed:77},
  {...SOLAR_SYSTEM_DATA.saturn,surfaceSeed:88}
 ];
 for(const body of bodies){
  const profile=createGeologicalProfile(body as never);
  const request={planetId:body.id,seed:profile.seed,tile:tileId(body.id==='earth'?0:4,body.id==='earth'?'2':''),resolution:body.id==='earth'?16:8,gutter:2,profile};
  const expected=generateSurfaceTile(request);
  const actual=generate_surface_tile(request.tile.face,request.tile.path,request.resolution,request.gutter,JSON.stringify(profile)) as {
   albedo:Uint8Array;normal:Uint8Array;height:Float32Array;roughness:Uint8Array;materialId:Uint8Array;
  };
  const byteChannels:[[Uint8Array,Uint8Array,string],[Uint8Array,Uint8Array,string],[Uint8Array,Uint8Array,string]]=[
   [actual.albedo,expected.albedo,'albedo'],[actual.normal,expected.normal,'normal'],[actual.roughness,expected.roughness,'roughness']
  ];
  for(const [left,right,label] of byteChannels){
   assert.equal(left.length,right.length,body.id+' '+label+' channel length');
   for(let i=0;i<left.length;i++)assert.ok(Math.abs(left[i]-right[i])<=1,body.id+' '+label+' byte '+i+' differs by more than one LSB');
  }
  assert.equal(actual.height.length,expected.height.length,body.id+' height channel length');
  for(let i=0;i<actual.height.length;i++)assert.ok(Math.abs(actual.height[i]-expected.height[i])<=0.01,body.id+' height sample '+i+' differs by more than 1 cm');
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

test('Rust ephemerides match the TypeScript reference at J2000, one day, 30 days and one year',async()=>{
 await initializeWasm();
 const catalog=createSolarSystemBodyCatalog(),legacy=createSolarSystemWorld();
 const rust=create_physics_world(JSON.stringify(catalog),JSON.stringify({fixedStepSeconds:60,maxSubSteps:2000}));
 const ids=rust.get_physics_snapshot().bodyIds as string[];
 const times=[0,86400,30*86400,365.25*86400];
 for(const time of times){
  const expected=legacy.getBodyStatesAt(time),actual=rust.get_body_states_at(time);
  for(const [id,state] of expected){
   const i=ids.indexOf(id);assert.notEqual(i,-1,'missing '+id);
   const o=i*6,dx=actual[o]-state.position.x,dy=actual[o+1]-state.position.y,dz=actual[o+2]-state.position.z;
   const dvx=actual[o+3]-state.velocity.x,dvy=actual[o+4]-state.velocity.y,dvz=actual[o+5]-state.velocity.z;
   const positionError=Math.hypot(dx,dy,dz),velocityError=Math.hypot(dvx,dvy,dvz);
   const positionScale=Math.hypot(state.position.x,state.position.y,state.position.z),velocityScale=Math.hypot(state.velocity.x,state.velocity.y,state.velocity.z);
   assert.ok(positionError<=Math.max(0.05,positionScale*1e-11),id+' position error at '+time+': '+positionError+' m');
   assert.ok(velocityError<=Math.max(2e-7,velocityScale*1e-11),id+' velocity error at '+time+': '+velocityError+' m/s');
  }
 }
 assert.equal(legacy.simulationTimeSeconds,0,'reference snapshots must not mutate simulation time');
 assert.equal(rust.get_physics_snapshot().simulationTimeSeconds,0,'Rust snapshots must not mutate simulation time');
 rust.dispose_physics_world();
});
test('Rust patched-conics entry preserves absolute vessel position and velocity',async()=>{
 await initializeWasm();
 const rust=create_physics_world(JSON.stringify(createSolarSystemBodyCatalog()),JSON.stringify({fixedStepSeconds:60,maxSubSteps:100}));
 const snapshot=rust.get_physics_snapshot() as {bodyIds:string[];bodyStates:Float64Array};
 const moon=snapshot.bodyIds.indexOf('moon'),m=moon*6;
 const soi=rust.get_sphere_of_influence('moon');assert.ok(soi&&soi>0);
 rust.add_vessel(JSON.stringify({id:'soi-probe',primaryBodyId:'earth',position:[snapshot.bodyStates[m]+soi*.5,snapshot.bodyStates[m+1],snapshot.bodyStates[m+2]],velocity:[snapshot.bodyStates[m+3],snapshot.bodyStates[m+4],snapshot.bodyStates[m+5]],massKg:1000}));
 rust.step_simulation();
 const vessel=JSON.parse(rust.get_vessel_state('soi-probe')),states=rust.get_body_states(),mo=moon*6;
 assert.equal(vessel.primaryBodyId,'moon');assert.equal(vessel.lastPrimarySwitch.to,'moon');assert.equal(vessel.primaryBodyHistory.length,1);assert.equal(vessel.primaryBodyHistory[0].from,'earth');
 for(let axis=0;axis<3;axis++){assert.ok(Math.abs(vessel.position[axis]-states[mo+axis]-vessel.relativePosition[axis])<1e-5);assert.ok(Math.abs(vessel.velocity[axis]-states[mo+3+axis]-vessel.relativeVelocity[axis])<1e-8);}
 rust.dispose_physics_world();
});

test('Rust/WASM universal propagation covers elliptic, hyperbolic and near-parabolic trajectories',async()=>{
 await initializeWasm();
 const mu=3.986004418e14,r=7_000_000,escape=Math.sqrt(2*mu/r);
 const cases=[
  {name:'elliptic',velocity:escape*.7,dt:2400},
  {name:'near-parabolic',velocity:escape*(1+1e-9),dt:900},
  {name:'hyperbolic',velocity:escape*1.2,dt:3600}
 ];
 for(const scenario of cases){
  const p=new Float64Array([r,0,0]),v=new Float64Array([0,scenario.velocity,0]);
  const forward=propagate_kepler(p,v,mu,scenario.dt,1e-11,200);
  assert.equal(forward.length,7,scenario.name+' state shape');
  assert.ok(Array.from(forward).every(Number.isFinite),scenario.name+' finite forward state');
  const back=propagate_kepler(new Float64Array(forward.slice(0,3)),new Float64Array(forward.slice(3,6)),mu,-scenario.dt,1e-11,200);
  const positionError=Math.hypot(back[0]-r,back[1],back[2])/r;
  const velocityError=Math.hypot(back[3],back[4]-scenario.velocity,back[5])/scenario.velocity;
  assert.ok(positionError<2e-8,scenario.name+' reverse position error '+positionError);
  assert.ok(velocityError<2e-8,scenario.name+' reverse velocity error '+velocityError);
 }
});
test('Solar3DView consumes Rust worker snapshots in the live application',async()=>{
 const [lab,view,client]=await Promise.all([read('lab/lab.ts'),read('src/presentation/solar-3d.ts'),read('src/wasm/physics/physics-world-client.ts')]);
 assert.match(lab,/import \{ PhysicsWorldClient \} from '\.\.\/src\/wasm\/physics\/physics-world-client\.ts'/);
 assert.match(lab,/world=new PhysicsWorldClient\(\)/);
 assert.match(lab,/await world\.initialize\(/);
 assert.match(lab,/solar3D\.render\(world,\s*renderedBodyStates/);
 assert.match(client,/this\.bridge\.initialize\(this\.catalog,options\)/);
 assert.match(client,/result\.renderBodyStates/);
 assert.match(view,/render\(world,states,timeSeconds/);
 assert.match(view,/bodies=\[\.\.\.world\.bodies\.values\(\)\]/);
 assert.match(view,/const bodyState=states\.get\(body\.id\)/);
 assert.doesNotMatch(lab,/orbitalElementsToState|rotateStateToParentEquator/);
 assert.match(lab,/world\.circularOrbitSpeed\(/);assert.match(lab,/world\.gravitationalParameter\(/);
});

test('Rust/WASM conic element conversion supports elliptic parabolic and hyperbolic states',async()=>{
 await initializeWasm();const mu=3.986004418e14,p=7_000_000;
 for(const eccentricity of [.4,1,1.4]){
  const state=conic_elements_to_state(p,eccentricity,.3,.4,.5,.6,mu);
  assert.equal(state.length,6);assert.ok(Array.from(state).every(Number.isFinite));
  const elements=state_to_orbital_elements(new Float64Array(state.slice(0,3)),new Float64Array(state.slice(3,6)),mu);
  assert.ok(Math.abs(elements[1]-eccentricity)<1e-10,'eccentricity round-trip '+eccentricity);
 }
});
test('Rust PhysicsWorld accumulator preserves fractional time across pause and rejects oversized backlogs atomically',async()=>{
 await initializeWasm();
 const world=create_physics_world(JSON.stringify([{id:'sun',name:'Sun',massKg:1.98847e30,meanRadiusM:696340000,position:[0,0,0],velocity:[0,0,0]}]),JSON.stringify({fixedStepSeconds:60,maxSubSteps:10}));
 world.set_time_scale(2);assert.equal(world.advance_simulation(45),1);
 let s=world.get_physics_snapshot();assert.equal(s.simulationTimeSeconds,60);assert.equal(s.accumulatorSeconds,30);
 world.set_paused(true);assert.equal(world.advance_simulation(100),0);s=world.get_physics_snapshot();assert.equal(s.simulationTimeSeconds,60);assert.equal(s.accumulatorSeconds,30);
 world.set_paused(false);assert.equal(world.advance_simulation(15),1);s=world.get_physics_snapshot();assert.equal(s.simulationTimeSeconds,120);assert.equal(s.accumulatorSeconds,0);
 assert.throws(()=>world.advance_simulation(60*11),/maxSubSteps/i);s=world.get_physics_snapshot();assert.equal(s.simulationTimeSeconds,120);assert.equal(s.accumulatorSeconds,0);
 world.dispose_physics_world();
});

test('Rust vessel stepping and powered burns match the retained TypeScript reference',async()=>{
 await initializeWasm();
 const legacy=createSolarSystemWorld(),catalog=createSolarSystemBodyCatalog();
 const rust=create_physics_world(JSON.stringify(catalog),JSON.stringify({fixedStepSeconds:60,maxSubSteps:100}));
 const earth=legacy.getBodyState('earth'),radius=7_000_000,speed=Math.sqrt(legacy.bodies.get('earth')!.mu/radius);
 const position={x:earth.position.x+radius,y:earth.position.y,z:earth.position.z};
 const velocity={x:earth.velocity.x,y:earth.velocity.y+speed,z:earth.velocity.z};
 legacy.addVessel({id:'parity-vessel',primaryBodyId:'earth',position,velocity,massKg:1000});
 rust.add_vessel(JSON.stringify({id:'parity-vessel',primaryBodyId:'earth',position:[position.x,position.y,position.z],velocity:[velocity.x,velocity.y,velocity.z],massKg:1000}));
 for(let i=0;i<10;i++){legacy.step();rust.step_simulation();}
 const compare=()=>{
  const expected=legacy.getVesselState('parity-vessel'),actual=JSON.parse(rust.get_vessel_state('parity-vessel'));
  const pe=Math.hypot(expected.position.x-actual.position[0],expected.position.y-actual.position[1],expected.position.z-actual.position[2]);
  const ve=Math.hypot(expected.velocity.x-actual.velocity[0],expected.velocity.y-actual.velocity[1],expected.velocity.z-actual.velocity[2]);
  assert.ok(pe<.05,'vessel absolute position parity '+pe+' m');assert.ok(ve<1e-5,'vessel absolute velocity parity '+ve+' m/s');
  assert.equal(expected.primaryBodyId,actual.primaryBodyId);
 };
 compare();
 const engine={vacuumThrustN:20_000,seaLevelThrustN:18_000,ispSeconds:300};
 const legacyBurn=executeIdealizedBurn(legacy,'parity-vessel',{direction:{x:0,y:1,z:0},deltaVMS:100,engine,ambientPressurePa:0,dryMassKg:700});
 const rustBurn=JSON.parse(rust.apply_idealized_burn('parity-vessel',new Float64Array([0,1,0]),100,engine.vacuumThrustN,engine.seaLevelThrustN,engine.ispSeconds,0,101325,700));
 assert.ok(Math.abs(legacyBurn.finalMassKg-rustBurn.finalMassKg)<1e-9);
 assert.ok(Math.abs(legacyBurn.propellantUsedKg-rustBurn.propellantUsedKg)<1e-9);
 compare();
 for(let i=0;i<10;i++){legacy.step();rust.step_simulation();}
 compare();
 rust.dispose_physics_world();
});

test('Rust orbit paths are generated by the physics world in the Worker',async()=>{
 await initializeWasm();
 const world=create_physics_world(JSON.stringify(createSolarSystemBodyCatalog()),JSON.stringify({fixedStepSeconds:60,maxSubSteps:2000}));
 const earth=world.get_orbit_path('earth',128),moon=world.get_orbit_path('moon',128);
 assert.equal(earth.length,129*3);assert.equal(moon.length,129*3);
 assert.ok(Array.from(earth).every(Number.isFinite));assert.ok(Array.from(moon).every(Number.isFinite));
 assert.ok(Math.hypot(earth[0]-earth[earth.length-3],earth[1]-earth[earth.length-2],earth[2]-earth[earth.length-1])<.05);
 assert.throws(()=>world.get_orbit_path('sun',128),/root body/i);
 world.dispose_physics_world();
});
test('Solar3DView uses precomputed Rust orbit paths instead of TypeScript Kepler conversion',async()=>{
 const [view,worker,client]=await Promise.all([read('src/presentation/solar-3d.ts'),read('src/wasm/physics/physics-worker.ts'),read('src/wasm/physics/physics-world-client.ts')]);
 assert.doesNotMatch(view,/orbitalElementsToState|rotateStateToParentEquator/);
 assert.match(view,/world\.orbitPaths\?\.get\(body\.id\)/);
 assert.match(worker,/get_orbit_path\(command\.bodyId,command\.segments\)/);
 assert.match(client,/ensureOrbitPath\(id:string,segments=/);
 assert.match(client,/this\.bridge\.orbitPath\(id,count\)/);
 assert.doesNotMatch(client,/this\.orbitPaths\.set\(id,await this\.bridge\.orbitPath/);
});

test('Rust owns circular-orbit speed and thrust-to-weight calculations',async()=>{
 await initializeWasm();
 const world=create_physics_world(JSON.stringify(createSolarSystemBodyCatalog()),JSON.stringify({fixedStepSeconds:60,maxSubSteps:10}));
 const earth=world.get_gravitational_parameter('earth'),speed=world.get_circular_orbit_speed('earth',7_000_000);
 assert.ok(Math.abs(speed-Math.sqrt(earth/7_000_000))<1e-10);
 const twr=thrust_to_weight_ratio(20_000,1_000,9.80665);
 assert.ok(Math.abs(twr-20_000/(1_000*9.80665))<1e-12);
 assert.equal(thrust_to_weight_ratio(0,1_000,9.80665),0,'an idle engine has zero thrust-to-weight ratio');
 assert.throws(()=>thrust_to_weight_ratio(-1,1_000,9.80665));
 world.dispose_physics_world();
});

test('Rust snapshots carry analytic spin angles into Solar3DView',async()=>{
 await initializeWasm();
 const world=create_physics_world(JSON.stringify(createSolarSystemBodyCatalog()),JSON.stringify({fixedStepSeconds:60,maxSubSteps:10}));
 const snapshot=world.get_physics_snapshot();
 assert.equal(snapshot.rotationAngles.length,50);
 assert.ok(Number.isFinite(snapshot.rotationAngles[snapshot.bodyIds.indexOf('earth')]));
 const [worker,client,view]=await Promise.all([read('src/wasm/physics/physics-worker.ts'),read('src/wasm/physics/physics-world-client.ts'),read('src/presentation/solar-3d.ts')]);
 assert.match(worker,/get_rotation_angles_at\(renderTime\)/);
 assert.match(client,/result\.renderRotationAngles/);
 assert.match(view,/world\.renderRotationAngles/);
 assert.doesNotMatch(view,/rotationAngleAt\?\./);
 world.dispose_physics_world();
});
