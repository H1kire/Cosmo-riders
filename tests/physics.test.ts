import test from 'node:test';
import assert from 'node:assert/strict';
import {AU,DAY,G,CelestialBody,PhysicsWorld,add,dot,gravitationalAcceleration,gravitationalParameter,magnitude,orbitalElementsToState,orbitalPeriod,propagateKepler,sphereOfInfluence,stateToOrbitalElements,vector3,createSolarSystemWorld,SOLAR_SYSTEM_DATA,SOLAR_SYSTEM_REFERENCE,executeIdealizedBurn,hohmannTransfer,engineThrustAtPressure,thrustToWeightRatio} from '../src/physics/index.ts';
import {formatScientific} from '../src/presentation/math-format.ts';
const earthMass=5.9722e24,earthMu=gravitationalParameter(earthMass);
test('SI constants and gravitational parameter',()=>{assert.equal(AU,149597870700);assert.equal(G,6.67430e-11);assert.ok(Number.isFinite(earthMu)&&earthMu>0);});
test('vector arithmetic',()=>{const a=vector3(1,2,3),b=vector3(4,5,6);assert.deepEqual(add(a,b),vector3(5,7,9));assert.equal(dot(a,b),32);assert.equal(magnitude(vector3(3,4,0)),5);});
test('gravity points inward and follows inverse square',()=>{const a=gravitationalAcceleration(vector3(7e6,0,0),earthMu),expected=earthMu/(7e6**2);assert.ok(a.x<0&&a.y===0&&a.z===0);assert.ok(Math.abs(magnitude(a)-expected)/expected<1e-12);});
test('circular orbit closes after one period',()=>{const r=7e6,v=Math.sqrt(earthMu/r),T=orbitalPeriod(r,earthMu),p=vector3(r,0,0),s=propagateKepler({position:p,velocity:vector3(0,v,0),mu:earthMu,deltaTimeSeconds:T});assert.ok(magnitude(vector3(s.position.x-r,s.position.y,s.position.z))/r<1e-8);assert.ok(magnitude(vector3(s.velocity.x,s.velocity.y-v,s.velocity.z))/v<1e-8);});
test('solver remains stable at astronomical scale',()=>{const mu=gravitationalParameter(1.98847e30),r=AU,v=Math.sqrt(mu/r),T=orbitalPeriod(r,mu),s=propagateKepler({position:vector3(r,0,0),velocity:vector3(0,v,0),mu,deltaTimeSeconds:T});assert.ok(Math.abs(magnitude(s.position)-r)/r<1e-8);assert.ok(Math.abs(s.position.y)/r<1e-8);});
test('specific orbital energy is conserved',()=>{const p=vector3(8e6,0,0),v=vector3(0,7000,900),before=0.5*dot(v,v)-earthMu/magnitude(p),s=propagateKepler({position:p,velocity:v,mu:earthMu,deltaTimeSeconds:1800}),after=0.5*dot(s.velocity,s.velocity)-earthMu/magnitude(s.position);assert.ok(Math.abs(after-before)/Math.abs(before)<1e-10);});
test('bound orbit propagation is reversible',()=>{const p=vector3(8e6,0,0),v=vector3(0,7000,900),f=propagateKepler({position:p,velocity:v,mu:earthMu,deltaTimeSeconds:2400}),b=propagateKepler({position:f.position,velocity:f.velocity,mu:earthMu,deltaTimeSeconds:-2400});assert.ok(magnitude(vector3(b.position.x-p.x,b.position.y-p.y,b.position.z-p.z))/magnitude(p)<1e-9);assert.ok(magnitude(vector3(b.velocity.x-v.x,b.velocity.y-v.y,b.velocity.z-v.z))/magnitude(v)<1e-9);});
test('hyperbolic escape is propagated',()=>{const r=7e6,esc=Math.sqrt(2*earthMu/r),s=propagateKepler({position:vector3(r,0,0),velocity:vector3(0,esc*1.2,0),mu:earthMu,deltaTimeSeconds:3600});assert.ok(magnitude(s.position)>r);assert.equal(stateToOrbitalElements(s.position,s.velocity,earthMu).trajectoryType,'hyperbolic');});
test('state conversion identifies circular elliptic orbit',()=>{const r=7e6,v=Math.sqrt(earthMu/r),e=stateToOrbitalElements(vector3(r,0,0),vector3(0,v,0),earthMu);assert.equal(e.trajectoryType,'elliptic');assert.ok(e.isCircular);assert.ok(Math.abs(e.semiMajorAxis-r)<1e-5);});
test('sphere of influence scale and invalid mass',()=>{const soi=sphereOfInfluence(AU,3.003e-6*1.98847e30,1.98847e30);assert.ok(soi>9e8&&soi<1e9);assert.throws(()=>sphereOfInfluence(AU,2,1),/smaller/);});
test('world fixed-step clock pause and time scale',()=>{const w=new PhysicsWorld({fixedStepSeconds:1});w.addBody(new CelestialBody({id:'earth',name:'Earth',massKg:earthMass,meanRadiusM:6.371e6}));w.addVessel({id:'v',primaryBodyId:'earth',position:vector3(7e6,0,0),velocity:vector3(0,7500,0)});w.setTimeScale(2);assert.equal(w.advance(1.5),3);assert.equal(w.simulationTimeSeconds,3);w.setPaused(true);assert.equal(w.advance(10),0);assert.equal(w.simulationTimeSeconds,3);});
test('TeX formatter',()=>{assert.equal(formatScientific(1000),'1\\times 10^{3}');assert.equal(formatScientific(0),'0');assert.throws(()=>formatScientific(NaN),/NaN/);});
test('day constant',()=>assert.equal(DAY,86400));
test('J2000 Earth orbital parameters match NASA reference values',()=>{const e=SOLAR_SYSTEM_DATA.earth.elements;assert.ok(Math.abs(e.semiMajorAxisM/AU-1.00000011)<1e-12);assert.ok(Math.abs(e.eccentricity-0.01671022)<1e-12);assert.ok(Math.abs(e.inclination*180/Math.PI-0.00005)<1e-10);});
test('orbital elements convert to a valid state and back',()=>{const mu=earthMu,el={semiMajorAxisM:7e6,eccentricity:0.1,inclination:0.3,longitudeAscendingNode:0.4,argumentOfPeriapsis:0.5,meanAnomaly:1.2},s=orbitalElementsToState(el,mu),out=stateToOrbitalElements(s.position,s.velocity,mu);assert.ok(Math.abs(out.semiMajorAxis-el.semiMajorAxisM)<1e-5);assert.ok(Math.abs(out.eccentricity-el.eccentricity)<1e-10);});
test('Sun-Earth-Moon ephemeris hierarchy updates with time',()=>{const w=createSolarSystemWorld({fixedStepSeconds:3600});const e0=w.getBodyState('earth'),m0=w.getBodyState('moon');assert.ok(Math.abs(magnitude(e0.position)-AU)<4e9);assert.ok(Math.abs(magnitude(add(m0.position,{x:-e0.position.x,y:-e0.position.y,z:-e0.position.z}))-384400000)<5e7);w.step();const e1=w.getBodyState('earth'),m1=w.getBodyState('moon');assert.ok(magnitude(vector3(e1.position.x-e0.position.x,e1.position.y-e0.position.y,e1.position.z-e0.position.z))>1e5);assert.ok(magnitude(vector3(m1.position.x-m0.position.x,m1.position.y-m0.position.y,m1.position.z-m0.position.z))>1e4);});
test('Earth and Moon spheres of influence are finite and nested',()=>{const w=createSolarSystemWorld();const earthSoi=w.getSphereOfInfluence('earth'),moonSoi=w.getSphereOfInfluence('moon');assert.ok(earthSoi>9e8&&earthSoi<1e9);assert.ok(moonSoi>5e7&&moonSoi<8e7);assert.ok(earthSoi>moonSoi);});
test('patched-conic primary changes from Earth to Moon inside Moon SOI',()=>{const w=createSolarSystemWorld({fixedStepSeconds:1});const earth=w.getBodyState('earth'),moon=w.getBodyState('moon');const moonOffset=vector3(moon.position.x-earth.position.x,moon.position.y-earth.position.y,moon.position.z-earth.position.z);const radial=vector3(moonOffset.x/magnitude(moonOffset),moonOffset.y/magnitude(moonOffset),moonOffset.z/magnitude(moonOffset));const p=vector3(moon.position.x-radial.x*1e6,moon.position.y-radial.y*1e6,moon.position.z-radial.z*1e6);const v=add(moon.velocity,vector3(0,100,0));w.addVessel({id:'probe',primaryBodyId:'earth',position:p,velocity:v});w.step();assert.equal(w.vessels.get('probe').primaryBodyId,'moon');assert.equal(w.vessels.get('probe').lastPrimarySwitch.to,'moon');});

test('patched-conic primary exits Moon SOI back to Earth',()=>{const w=createSolarSystemWorld({fixedStepSeconds:1});const earth=w.getBodyState('earth'),moon=w.getBodyState('moon');const offset=vector3(moon.position.x-earth.position.x,moon.position.y-earth.position.y,moon.position.z-earth.position.z);const radial=vector3(offset.x/magnitude(offset),offset.y/magnitude(offset),offset.z/magnitude(offset));const p=vector3(moon.position.x-radial.x*1e6,moon.position.y-radial.y*1e6,moon.position.z-radial.z*1e6);w.addVessel({id:'returning-probe',primaryBodyId:'moon',position:p,velocity:moon.velocity});const vessel=w.vessels.get('returning-probe');vessel.position=vector3(moon.position.x+radial.x*1e8,moon.position.y+radial.y*1e8,moon.position.z+radial.z*1e8);vessel.velocity=moon.velocity;vessel.relativePosition=vector3(radial.x*1e8,radial.y*1e8,radial.z*1e8);vessel.relativeVelocity=vector3(0,0,0);w.step();assert.equal(vessel.primaryBodyId,'earth');});
test('body hierarchy rejects missing parent and multiple roots',()=>{const w=new PhysicsWorld();assert.throws(()=>w.addBody(new CelestialBody({id:'moon',name:'Moon',massKg:7.34e22,meanRadiusM:1.7e6,parentId:'earth'})),/Parent body not found/);w.addBody(new CelestialBody({id:'sun',name:'Sun',massKg:1.98847e30,meanRadiusM:6.957e8}));assert.throws(()=>w.addBody(new CelestialBody({id:'other',name:'Other',massKg:1e20,meanRadiusM:1e5})),/Only one root/);});
test('ephemeris is deterministic for equal J2000 elapsed time',()=>{const a=createSolarSystemWorld({fixedStepSeconds:3600}),b=createSolarSystemWorld({fixedStepSeconds:3600});for(let i=0;i<24;i++){a.step();b.step();}for(const id of ['sun','earth','moon']){const x=a.getBodyState(id),y=b.getBodyState(id);assert.deepEqual(x.position,y.position);assert.deepEqual(x.velocity,y.velocity);}});


test('elliptic orbit exposes correct periapsis and apoapsis radii',()=>{
 const a=10e6,e=0.2,rp=a*(1-e),vp=Math.sqrt(earthMu*(2/rp-1/a));
 const elements=stateToOrbitalElements(vector3(rp,0,0),vector3(0,vp,0),earthMu);
 assert.ok(Math.abs(elements.semiMajorAxis-a)<1e-5);
 assert.ok(Math.abs(elements.eccentricity-e)<1e-10);
 assert.ok(Math.abs(elements.semiMajorAxis*(1-elements.eccentricity)-rp)<1e-5);
 assert.ok(Math.abs(elements.semiMajorAxis*(1+elements.eccentricity)-a*(1+e))<1e-5);
});
test('specific angular momentum is conserved during Kepler propagation',()=>{
 const p=vector3(8e6,0,0),v=vector3(0,7000,900),h0=Math.sqrt((p.y*v.z-p.z*v.y)**2+(p.z*v.x-p.x*v.z)**2+(p.x*v.y-p.y*v.x)**2);
 const s=propagateKepler({position:p,velocity:v,mu:earthMu,deltaTimeSeconds:5400});
 const h1=Math.sqrt((s.position.y*s.velocity.z-s.position.z*s.velocity.y)**2+(s.position.z*s.velocity.x-s.position.x*s.velocity.z)**2+(s.position.x*s.velocity.y-s.position.y*s.velocity.x)**2);
 assert.ok(Math.abs(h1-h0)/h0<1e-10);
});
test('Solar System includes all eight planets and the Earth-Moon hierarchy',()=>{
 const w=createSolarSystemWorld();
 assert.equal(w.bodies.size,50);
 for(const id of ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune']) {
  assert.equal(w.bodies.get(id).parentId,'sun');
  assert.ok(magnitude(w.getBodyState(id).position)>0);
 }
 assert.equal(w.bodies.get('moon').parentId,'earth');
});
test('Hohmann transfer returns positive burns and half-ellipse transfer time',()=>{
 const result=hohmannTransfer({primaryMu:gravitationalParameter(1.98847e30),initialRadiusM:AU,targetRadiusM:1.52371034*AU});
 assert.ok(result.departureDeltaVMS>0);
 assert.ok(result.arrivalDeltaVMS>0);
 assert.equal(result.totalDeltaVMS,result.departureDeltaVMS+result.arrivalDeltaVMS);
 assert.ok(result.transferTimeSeconds>0);
});
test('engine thrust decreases with ambient pressure and TWR is dimensionless',()=>{
 const vacuum=engineThrustAtPressure({vacuumThrustN:1e6,seaLevelThrustN:900000,ambientPressurePa:0});
 const sea=engineThrustAtPressure({vacuumThrustN:1e6,seaLevelThrustN:900000,ambientPressurePa:101325});
 assert.equal(vacuum,1e6);
 assert.equal(sea,900000);
 assert.ok(thrustToWeightRatio(10000,1000,9.80665)>1);
});
test('idealized rocket-equation burn consumes propellant and changes velocity',()=>{
 const w=createSolarSystemWorld();
 const earth=w.getBodyState('earth');
 const vessel=w.addVessel({id:'burn-test',primaryBodyId:'earth',position:add(earth.position,vector3(7e6,0,0)),velocity:add(earth.velocity,vector3(0,7500,0)),massKg:1000});
 const result=executeIdealizedBurn(w,'burn-test',{direction:vector3(0,1,0),deltaVMS:100,engine:{vacuumThrustN:20000,seaLevelThrustN:18000,ispSeconds:300},dryMassKg:700});
 assert.ok(result.propellantUsedKg>0);
 assert.ok(result.burnDurationSeconds>0);
 assert.ok(vessel.massKg<1000&&vessel.massKg>700);
 assert.ok(Math.abs(vessel.relativeVelocity.y-7600)<1e-8);
});

test('fractional ephemeris snapshots are smooth and do not mutate committed world state',()=>{
 const w=createSolarSystemWorld({fixedStepSeconds:60});
 const committed=w.getBodyState('earth');
 const start=committed.position;
 const half=w.getBodyStatesAt(30).get('earth').position;
 const end=w.getBodyStatesAt(60).get('earth').position;
 assert.ok(magnitude(vector3(half.x-start.x,half.y-start.y,half.z-start.z))>0);
 assert.ok(magnitude(vector3(end.x-half.x,end.y-half.y,end.z-half.z))>0);
 assert.deepEqual(w.getBodyState('earth').position,start);
});
test('fractional vessel state advances smoothly without mutating the physical vessel',()=>{
 const w=createSolarSystemWorld({fixedStepSeconds:60});
 const earth=w.getBodyState('earth');
 const v=w.addVessel({id:'fractional-vessel',primaryBodyId:'earth',position:add(earth.position,vector3(7e6,0,0)),velocity:add(earth.velocity,vector3(0,7500,0))});
 const committed={position:v.position,velocity:v.velocity};
 const half=w.getVesselStateAt('fractional-vessel',30);
 assert.ok(magnitude(vector3(half.position.x-committed.position.x,half.position.y-committed.position.y,half.position.z-committed.position.z))>0);
 assert.deepEqual(v.position,committed.position);
 assert.deepEqual(v.velocity,committed.velocity);
});

test('JPL satellite systems use physical semi-major axes and mean radii',()=>{
 const w=createSolarSystemWorld();
 const expected=[
  ['moon','earth',384400000,1737400],
  ['phobos','mars',9375000,11080],
  ['io','jupiter',421800000,1821490],
  ['europa','jupiter',671100000,1560800],
  ['ganymede','jupiter',1070400000,2631200],
  ['callisto','jupiter',1882700000,2410300],
  ['titan','saturn',1221860000,2574760],
  ['miranda','uranus',129900000,235800],
  ['triton','neptune',354760000,1352600]
 ] as const;
 for(const [id,parent,a,r] of expected){
  const body=w.bodies.get(id);
  assert.ok(body, 'missing '+id);
  assert.equal(body.parentId,parent);
  assert.equal(body.semiMajorAxisM,a);
  assert.equal(body.meanRadiusM,r);
 }
 assert.equal(w.bodies.size,50);
 assert.equal([...w.bodies.values()].filter(body=>body.parentId!=='sun'&&body.parentId!==null).length,41);
});

test('Moon rendering inputs preserve the Earth-relative physical orbit and radius ratio',()=>{
 const w=createSolarSystemWorld();
 const earth=w.getBodyState('earth'),moon=w.getBodyState('moon');
 const relative=vector3(moon.position.x-earth.position.x,moon.position.y-earth.position.y,moon.position.z-earth.position.z);
 assert.ok(Math.abs(magnitude(relative)-384400000)<5e7);
 const moonBody=w.bodies.get('moon'),earthBody=w.bodies.get('earth');
 assert.equal(moonBody.parentId,'earth');
 assert.ok(Math.abs(moonBody.meanRadiusM/earthBody.meanRadiusM-0.2727)<0.001);
 assert.ok(moonBody.meanRadiusM/AU<0.000012);
});
