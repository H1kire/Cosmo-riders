import test from 'node:test';
import assert from 'node:assert/strict';
import { PhysicsWorldClient } from '../src/wasm/physics/physics-world-client.ts';
import type { PhysicsBridge } from '../src/wasm/physics/physics-bridge.ts';
import { CelestialBody } from '../src/physics/celestial-body.ts';
import { createSolarSystemBodyCatalog, createSolarSystemWorld } from '../src/physics/solar-system.ts';

function fakeBridge(orbitPath:(id:string,segments:number)=>Promise<Float64Array>):PhysicsBridge{
 return {orbitPath,dispose:async()=>{}} as unknown as PhysicsBridge;
}

test('osculating orbit cache refreshes after simulation state advances without per-frame requests',async()=>{
 let requests=0;
 const client=new PhysicsWorldClient([],fakeBridge(async(_id,segments)=>{
  requests++;
  return new Float64Array((segments+1)*3).fill(requests);
 }));
 const body=new CelestialBody({
  id:'earth',name:'Earth',massKg:5.9722e24,meanRadiusM:6_371_000,parentId:'sun',
  orbitalElements:{semiMajorAxisM:149_597_870_700,eccentricity:.0167,inclination:0,longitudeAscendingNode:0,argumentOfPeriapsis:0,meanAnomaly:0}
 });
 client.bodies.set('earth',body);
 try{
  await client.ensureOrbitPath('earth',16);
  assert.equal(requests,1);
  await client.ensureOrbitPath('earth',16);
  assert.equal(requests,1,'unchanged simulation state reuses the cached path');
  client.simulationTimeSeconds=60;
  await client.ensureOrbitPath('earth',16);
  assert.equal(requests,1,'recently refreshed path is reused during the 250 ms throttle window');
  await new Promise(resolve=>setTimeout(resolve,270));
  await client.ensureOrbitPath('earth',16);
  assert.equal(requests,2,'advanced simulation state triggers a refreshed osculating path');
 }finally{
  await client.dispose();
 }
});

test('PhysicsWorldClient preserves parent-relative path origins for all 49 catalogue bodies',async()=>{
 const catalog=createSolarSystemBodyCatalog(),world=createSolarSystemWorld();
 let client!:PhysicsWorldClient;
 const bridge=fakeBridge(async(id,segments)=>{
  const body=client.bodies.get(id)!;
  const state=client.getBodyState(id),parent=client.getBodyState(body.parentId!);
  const path=new Float64Array((segments+1)*3);
  path[0]=state.position.x-parent.position.x;
  path[1]=state.position.y-parent.position.y;
  path[2]=state.position.z-parent.position.z;
  return path;
 });
 client=new PhysicsWorldClient(catalog,bridge);
 for(const entry of catalog){
  const state=world.getBodyState(entry.id);
  const body=new CelestialBody({...entry,position:state.position,velocity:state.velocity} as never);
  client.bodies.set(body.id,body);
  client.bodyStates.set(body.id,state);
 }
 try{
  let checked=0;
  for(const [id,body] of client.bodies){
   if(!body.parentId)continue;
   const path=await client.ensureOrbitPath(id,64);
   const state=client.getBodyState(id),parent=client.getBodyState(body.parentId);
   const dx=path[0]-(state.position.x-parent.position.x);
   const dy=path[1]-(state.position.y-parent.position.y);
   const dz=path[2]-(state.position.z-parent.position.z);
   const radius=Math.hypot(state.position.x-parent.position.x,state.position.y-parent.position.y,state.position.z-parent.position.z);
   assert.ok(Math.hypot(dx,dy,dz)<=Math.max(1e-3,radius*1e-8),id+' path start must match current parent-relative state');
   checked++;
  }
  assert.equal(checked,49);
 }finally{
  await client.dispose();
 }
});
