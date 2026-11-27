import test from 'node:test';
import assert from 'node:assert/strict';
import {AU,DAY,G,CelestialBody,PhysicsWorld,add,dot,gravitationalAcceleration,gravitationalParameter,magnitude,orbitalElementsToState,orbitalPeriod,propagateKepler,sphereOfInfluence,stateToOrbitalElements,vector3,createSolarSystemWorld,createSolarSystemBodyCatalog,SOLAR_SYSTEM_DATA,SOLAR_SYSTEM_REFERENCE,executeIdealizedBurn,hohmannTransfer,engineThrustAtPressure,thrustToWeightRatio} from '../src/physics/index.ts';
import {formatScientific} from '../src/presentation/math-format.ts';
import {rotateStateToParentEquator} from '../src/physics/orbital-frame.ts';
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
test('all eight J2000 planetary semimajor axes, eccentricities and inclinations match the catalogue reference',()=>{
 const expected=[
  ['mercury',.38709927,.20563593,7.00497902,48.33076593,77.45779628,252.25032350],
  ['venus',.72333566,.00677672,3.39467605,76.67984255,131.60246718,181.97909950],
  ['earth',1.00000011,.01671022,.00005,-11.26064,102.94719,100.46457166],
  ['mars',1.52371034,.09339410,1.84969142,49.55953891,336.05637041,355.44656795],
  ['jupiter',5.20288700,.04838624,1.30439695,100.47390909,14.72847983,34.39644051],
  ['saturn',9.53667594,.05386179,2.48599187,113.66242448,92.59887831,49.95424423],
  ['uranus',19.18916464,.04725744,.77263783,74.01692503,170.95427630,313.23810451],
  ['neptune',30.06992276,.00859048,1.77004347,131.78422574,44.96476227,304.88003]
 ] as const;
 const wrap=(value:number)=>((value%360)+360)%360;
 for(const [id,a,e,i,node,perihelion,meanLongitude] of expected){
  const elements=SOLAR_SYSTEM_DATA[id].elements;
  assert.ok(Math.abs(elements.semiMajorAxisM/AU-a)<1e-10,id+' semimajor axis');
  assert.ok(Math.abs(elements.eccentricity-e)<1e-10,id+' eccentricity');
  assert.ok(Math.abs(elements.inclination*180/Math.PI-i)<1e-8,id+' inclination');
  assert.ok(Math.abs(wrap(elements.longitudeAscendingNode*180/Math.PI)-wrap(node))<1e-8,id+' ascending node');
  assert.ok(Math.abs(wrap(elements.argumentOfPeriapsis*180/Math.PI)-wrap(perihelion-node))<1e-8,id+' argument of periapsis');
  assert.ok(Math.abs(wrap(elements.meanAnomaly*180/Math.PI)-wrap(meanLongitude-perihelion))<1e-8,id+' mean anomaly');
 }
});

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

test('sidereal rotation is analytic, deterministic and independent of frame stepping',()=>{
 const body=new CelestialBody({id:'spin-test',name:'Spin test',massKg:1e20,meanRadiusM:1e6,rotationPeriodSeconds:10,rotationDirection:-1,axialTiltRad:.4,primeMeridianRad:.2});
 assert.equal(body.rotationAngleAt(0),.2);
 assert.ok(Math.abs(body.rotationAngleAt(2.5)!-(.2-Math.PI/2))<1e-12);
 assert.ok(Math.abs(body.rotationAngleAt(12.5)!-(.2-2.5*Math.PI))<1e-12);
 const same=new CelestialBody({id:'spin-test-2',name:'Spin test 2',massKg:1e20,meanRadiusM:1e6,rotationPeriodSeconds:10,rotationDirection:-1,axialTiltRad:.4,primeMeridianRad:.2});
 assert.equal(body.rotationAngleAt(12345),same.rotationAngleAt(12345));
});
test('Solar System planets expose sidereal spin and axial obliquity as physical inputs',()=>{
 const world=createSolarSystemWorld();
 for(const id of ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune']){
  const body=world.bodies.get(id)!;
  assert.ok(body.rotationPeriodSeconds!==null&&body.rotationPeriodSeconds>0,id+' missing spin period');
  assert.ok(body.axialTiltRad!==null&&Number.isFinite(body.axialTiltRad),id+' missing axial tilt');
  assert.ok(body.poleRightAscensionRad!==null&&body.poleDeclinationRad!==null,id+' missing IAU pole direction');
 }
 assert.ok(world.bodies.get('venus')!.axialTiltRad!>Math.PI/2);
 assert.ok(world.bodies.get('uranus')!.axialTiltRad!>Math.PI/2);
 assert.equal(world.bodies.get('venus')!.rotationDirection,-1);
 assert.equal(world.bodies.get('uranus')!.rotationDirection,-1);
 assert.ok(Math.abs(world.bodies.get('venus')!.primeMeridianRad!-160.20*Math.PI/180)<1e-12);
});
test('satellite reference frames are transformed into the parent equatorial plane',()=>{
 const world=createSolarSystemWorld();
 const jupiter=world.bodies.get('jupiter')!,io=world.bodies.get('io')!;
 const js=world.getBodyState('jupiter'),is=world.getBodyState('io');
 const r={x:is.position.x-js.position.x,y:is.position.y-js.position.y,z:is.position.z-js.position.z};
 const ra=jupiter.poleRightAscensionRad!,dec=jupiter.poleDeclinationRad!,eps=23.4392911*Math.PI/180;
 const pole={x:Math.cos(dec)*Math.cos(ra),y:Math.cos(eps)*Math.cos(dec)*Math.sin(ra)+Math.sin(eps)*Math.sin(dec),z:-Math.sin(eps)*Math.cos(dec)*Math.sin(ra)+Math.cos(eps)*Math.sin(dec)};
 const planeError=Math.abs(r.x*pole.x+r.y*pole.y+r.z*pole.z)/Math.hypot(r.x,r.y,r.z);
 assert.ok(planeError<1e-10,'Io mean orbit should lie in the modeled Jupiter-equatorial plane');
});
test('satellite reference frames are transformed into the parent equatorial plane',()=>{
 const world=createSolarSystemWorld();
 const jupiter=world.bodies.get('jupiter')!,io=world.bodies.get('io')!;
 const js=world.getBodyState('jupiter'),is=world.getBodyState('io');
 const r={x:is.position.x-js.position.x,y:is.position.y-js.position.y,z:is.position.z-js.position.z};
 const ra=jupiter.poleRightAscensionRad!,dec=jupiter.poleDeclinationRad!,eps=23.4392911*Math.PI/180;
 const pole={x:Math.cos(dec)*Math.cos(ra),y:Math.cos(eps)*Math.cos(dec)*Math.sin(ra)+Math.sin(eps)*Math.sin(dec),z:-Math.sin(eps)*Math.cos(dec)*Math.sin(ra)+Math.cos(eps)*Math.sin(dec)};
 const planeError=Math.abs(r.x*pole.x+r.y*pole.y+r.z*pole.z)/Math.hypot(r.x,r.y,r.z);
 assert.ok(planeError<1e-10,'Io mean orbit should lie in the modeled Jupiter-equatorial plane');
});
test('regular moons use parent-facing synchronous orientation and orbital-period spin',()=>{
 const world=createSolarSystemWorld();
 for(const id of ['moon','phobos','deimos','io','europa','ganymede','callisto','titan','triton']){
  const body=world.bodies.get(id)!;
  assert.equal(body.tidalLock,true,id+' should be tidally locked');
  assert.ok(body.rotationPeriodSeconds!==null&&body.rotationPeriodSeconds>0,id+' missing synchronous period');
 }
 assert.equal(world.bodies.get('hyperion')!.tidalLock,false);
 assert.equal(world.bodies.get('hyperion')!.rotationPeriodSeconds,null);
});

test('all 49 satellite and planetary orbits remain inside their J2000 Keplerian apsis bounds',()=>{
 const world=createSolarSystemWorld();
 const snapshots=[-365.25*DAY,0,365.25*DAY,10*365.25*DAY];
 const orbiting=[...world.bodies.values()].filter(body=>body.parentId!==null);
 assert.equal(orbiting.length,49);
 for(const body of orbiting){
  const parent=world.bodies.get(body.parentId!);
  const initial=world.bodyInitialRelativeStates.get(body.id);
  assert.ok(parent&&initial,'missing parent-relative state for '+body.id);
  const elements=stateToOrbitalElements(initial.position,initial.velocity,body.mu+parent.mu);
  const configured=body.orbitalElements!;
  assert.ok(Math.abs(elements.semiMajorAxis-configured.semiMajorAxisM)/configured.semiMajorAxisM<1e-8,'semi-major axis mismatch for '+body.id);
  assert.ok(Math.abs(elements.eccentricity-configured.eccentricity)<1e-8,'eccentricity mismatch for '+body.id);
  const periapsis=configured.semiMajorAxisM*(1-configured.eccentricity);
  const apoapsis=configured.semiMajorAxisM*(1+configured.eccentricity);
  for(const time of snapshots){
   const states=world.getBodyStatesAt(time);
   const state=states.get(body.id)!,parentState=states.get(parent.id)!;
   const relative=vector3(state.position.x-parentState.position.x,state.position.y-parentState.position.y,state.position.z-parentState.position.z);
   const radius=magnitude(relative);
   assert.ok(Number.isFinite(radius)&&radius>=periapsis*(1-1e-8)&&radius<=apoapsis*(1+1e-8),body.id+' escaped its apsis bounds at '+time+' s');
  }
 }
});

test('corrected JPL satellite angles and reference planes are preserved in the 49-body catalogue',()=>{
 const world=createSolarSystemWorld();
 const expected=[
  ['phobos',9375,.015,216.3,189.7,1.1,169.2],
  ['deimos',23457,0,0,205,1.8,54.3],
  ['ganymede',1070400,.001,198.3,324.8,.2,58.5],
  ['callisto',1882700,.007,43.8,87.4,.3,309.1],
  ['rhea',527200,.001,44.3,31.5,.3,133.7],
  ['titan',1221900,.029,78.3,11.7,.3,78.6],
  ['hyperion',1481500,.105,214,122.9,.6,87.1],
  ['iapetus',3561700,.028,254.5,74.8,7.6,86.5],
  ['miranda',129846,.001,154.8,73,4.4,100.9],
  ['ariel',190929,.001,9.6,193.5,0,0],
  ['umbriel',265986,.004,183.4,253,.1,174.8],
  ['titania',436298,.002,184,68.1,.1,29.5],
  ['oberon',583511,.002,132.2,143.6,.1,76.8],
  ['triton',354800,0,0,63,157.3,177.7],
  ['naiad',48300,.001,144.5,6.1,4.7,38.7],
  ['thalassa',50100,.001,223.6,3,.2,124.7],
  ['despina',52600,.001,182.1,354.1,0,0],
  ['galatea',62000,.001,113.9,12,0,0],
  ['larissa',73600,.001,222,215.1,.2,317.4],
  ['proteus',117700,.001,357.2,297.4,.6,355.5]
 ] as const;
 for(const [id,a,e,omega,mean,inclination,node] of expected){
  const elements=world.bodies.get(id)!.orbitalElements!;
  assert.ok(Math.abs(elements.semiMajorAxisM/1000-a)<1e-6,id+' semi-major axis');
  assert.ok(Math.abs(elements.eccentricity-e)<1e-12,id+' eccentricity');
  assert.ok(Math.abs(elements.argumentOfPeriapsis*180/Math.PI-omega)<1e-8,id+' argument of periapsis');
  assert.ok(Math.abs(elements.meanAnomaly*180/Math.PI-mean)<1e-8,id+' mean anomaly');
  assert.ok(Math.abs(elements.inclination*180/Math.PI-inclination)<1e-8,id+' inclination');
  assert.ok(Math.abs(elements.longitudeAscendingNode*180/Math.PI-node)<1e-8,id+' ascending node');
 }
 const himalia=world.bodies.get('himalia')!,nereid=world.bodies.get('nereid')!,iapetus=world.bodies.get('iapetus')!,phoebe=world.bodies.get('phoebe')!,titan=world.bodies.get('titan')!,hyperion=world.bodies.get('hyperion')!,phobos=world.bodies.get('phobos')!,deimos=world.bodies.get('deimos')!,ganymede=world.bodies.get('ganymede')!,callisto=world.bodies.get('callisto')!;
 assert.equal(himalia.orbitalReferenceFrame,'ecliptic');
 assert.equal(phobos.orbitalReferenceFrame,'laplace');
 assert.equal(deimos.orbitalReferenceFrame,'laplace');
 assert.equal(ganymede.orbitalReferenceFrame,'laplace');
 assert.equal(callisto.orbitalReferenceFrame,'laplace');
 assert.ok(Math.abs(phobos.orbitalPlanePoleRightAscensionRad!*180/Math.PI-317.7)<1e-8);
 assert.ok(Math.abs(deimos.orbitalPlanePoleDeclinationRad!*180/Math.PI-53.5)<1e-8);
 assert.ok(Math.abs(ganymede.orbitalPlanePoleDeclinationRad!*180/Math.PI-64.6)<1e-8);
 assert.ok(Math.abs(callisto.orbitalPlanePoleRightAscensionRad!*180/Math.PI-268.7)<1e-8);
 assert.equal(nereid.orbitalReferenceFrame,'ecliptic');
 assert.ok(Math.abs(nereid.orbitalElements!.meanAnomaly*180/Math.PI-216.6984)<1e-3);
 assert.equal(iapetus.orbitalReferenceFrame,'laplace');
 assert.equal(phoebe.orbitalReferenceFrame,'laplace');
 assert.equal(titan.orbitalReferenceFrame,'laplace');
 assert.equal(hyperion.orbitalReferenceFrame,'laplace');
 assert.ok(Math.abs(titan.orbitalPlanePoleRightAscensionRad!*180/Math.PI-36.4)<1e-8);
 assert.ok(Math.abs(hyperion.orbitalPlanePoleDeclinationRad!*180/Math.PI-83.6)<1e-8);
 assert.ok(Math.abs(iapetus.orbitalPlanePoleRightAscensionRad!*180/Math.PI-288.7)<1e-8);
 assert.ok(Math.abs(phoebe.orbitalPlanePoleDeclinationRad!*180/Math.PI-67.5)<1e-8);
});

test('J2000 Moon mean elements match the JPL planetary satellite table',()=>{
 const moon=SOLAR_SYSTEM_DATA.moon.elements;
 assert.equal(moon.semiMajorAxisM,384400000);
 assert.ok(Math.abs(moon.eccentricity-0.0554)<1e-12);
 assert.ok(Math.abs(moon.inclination*180/Math.PI-5.16)<1e-10);
 assert.ok(Math.abs(moon.longitudeAscendingNode*180/Math.PI-125.08)<1e-10);
 assert.ok(Math.abs(moon.argumentOfPeriapsis*180/Math.PI-318.15)<1e-10);
 assert.ok(Math.abs(moon.meanAnomaly*180/Math.PI-135.27)<1e-10);
});


test('JS ephemeris transforms Laplace-plane satellite states into the shared ecliptic frame',()=>{
 const parent=new CelestialBody({id:'laplace-parent',name:'Parent',massKg:1e20,meanRadiusM:1e6,poleRightAscensionRad:0,poleDeclinationRad:Math.PI/2});
 const body=new CelestialBody({id:'laplace-moon',name:'Laplace moon',massKg:1e12,meanRadiusM:1e4,orbitalReferenceFrame:'laplace',orbitalPlanePoleRightAscensionRad:Math.PI/2,orbitalPlanePoleDeclinationRad:0});
 const state={position:vector3(1,0,0),velocity:vector3(0,1,0)};
 const transformed=rotateStateToParentEquator(state,body,parent);
 const epsilon=23.4392911*Math.PI/180,pole=[0,Math.cos(epsilon),-Math.sin(epsilon)];
 const normalDot=transformed.position.x*pole[0]+transformed.position.y*pole[1]+transformed.position.z*pole[2];
 assert.ok(Math.abs(normalDot)<1e-12);
 assert.ok(Math.abs(magnitude(transformed.position)-1)<1e-12);
 assert.ok(Math.abs(magnitude(transformed.velocity)-1)<1e-12);
 assert.ok(Math.abs(transformed.velocity.z)>0.1);
});


test('WASM body catalogue preserves explicit Laplace-plane pole metadata',()=>{
 const catalogue=createSolarSystemBodyCatalog();
 const iapetus=catalogue.find(body=>body.id==='iapetus')!,phoebe=catalogue.find(body=>body.id==='phoebe')!;
 assert.equal(iapetus.orbitalReferenceFrame,'laplace');
 assert.equal(phoebe.orbitalReferenceFrame,'laplace');
 assert.ok(Math.abs(Number(iapetus.orbitalPlanePoleRightAscensionRad)-288.7*Math.PI/180)<1e-12);
 assert.ok(Math.abs(Number(iapetus.orbitalPlanePoleDeclinationRad)-78.9*Math.PI/180)<1e-12);
 assert.ok(Math.abs(Number(phoebe.orbitalPlanePoleRightAscensionRad)-276*Math.PI/180)<1e-12);
 assert.ok(Math.abs(Number(phoebe.orbitalPlanePoleDeclinationRad)-67.5*Math.PI/180)<1e-12);
});
