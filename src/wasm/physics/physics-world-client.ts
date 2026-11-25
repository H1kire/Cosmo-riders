import {createSolarSystemBodyCatalog} from '../../physics/solar-system.ts';
import {CelestialBody} from '../../physics/celestial-body.ts';
import {vector3} from '../../physics/vector3.ts';
import {PhysicsBridge} from './physics-bridge.ts';
import type {PhysicsSnapshot} from './physics-protocol.ts';
type V3=Readonly<{x:number;y:number;z:number}>;
export interface PhysicsState{readonly position:V3;readonly velocity:V3}
export interface VesselSnapshot extends PhysicsState{readonly id:string;readonly primaryBodyId:string;readonly relativePosition:V3;readonly relativeVelocity:V3;readonly massKg:number;readonly lastPrimarySwitch:{from:string;to:string;timeSeconds:number}|null;readonly primaryBodyHistory:readonly {from:string;to:string;timeSeconds:number}[]}
type BodyMetadata=CelestialBody;
const vector=(a:ArrayLike<number>,offset=0):V3=>({x:a[offset],y:a[offset+1],z:a[offset+2]});
export class PhysicsWorldClient{
 readonly bridge=new PhysicsBridge();readonly bodies=new Map<string,BodyMetadata>();readonly vessels=new Map<string,VesselSnapshot>();readonly sphereOfInfluence=new Map<string,number|null>();readonly orbitalPeriods=new Map<string,number|null>();readonly orbitPaths=new Map<string,Float64Array>();
 simulationTimeSeconds=0;accumulator=0;timeScale=1;paused=false;readonly bodyStates=new Map<string,PhysicsState>();readonly renderBodyStates=new Map<string,PhysicsState>();readonly renderVessels=new Map<string,VesselSnapshot>();
 constructor(private readonly catalog=createSolarSystemBodyCatalog()){}
 async initialize(options:Record<string,number>={fixedStepSeconds:60,maxSubSteps:2000}):Promise<void>{
  await this.bridge.initialize(this.catalog,options);
  for(const entry of this.catalog){
   const b=entry as Record<string,any>;
   const metadata=new CelestialBody({...b,id:String(b.id),name:String(b.name),massKg:Number(b.massKg),meanRadiusM:Number(b.meanRadiusM),position:vector3(),velocity:vector3(),surfaceSeed:b.surfaceSeed??undefined,rotationPeriodSeconds:b.rotationPeriodSeconds??null,axialTiltRad:b.axialTiltRad??null,poleRightAscensionRad:b.poleRightAscensionRad??null,poleDeclinationRad:b.poleDeclinationRad??null,equatorialRadiusM:b.equatorialRadiusM??null,solarDaySeconds:b.solarDaySeconds??null});
   this.bodies.set(metadata.id,metadata);
  }
  await Promise.all(this.catalog.map(async entry=>{
   const b=entry as Record<string,any>,id=String(b.id),metadata=this.bodies.get(id)!;
   this.sphereOfInfluence.set(id,await this.bridge.sphereOfInfluence(id));
   const parent=metadata.parentId?this.bodies.get(metadata.parentId):null;
   const period=metadata.rotationPeriodSeconds??(metadata.tidalLock&&metadata.semiMajorAxisM&&parent?await this.bridge.orbitalPeriod(metadata.semiMajorAxisM,metadata.mu+parent.mu):null);
   this.orbitalPeriods.set(id,period);
   if(metadata.parentId&&metadata.orbitalElements)this.orbitPaths.set(id,await this.bridge.orbitPath(id,1024));
  }));
  await this.refresh(await this.bridge.snapshot());
 }
 private async refresh(s:PhysicsSnapshot):Promise<void>{
  this.simulationTimeSeconds=s.simulationTimeSeconds;this.accumulator=s.accumulatorSeconds;this.timeScale=s.timeScale;this.paused=s.paused;
  this.bodyStates.clear();s.bodyIds.forEach((id,i)=>this.bodyStates.set(id,{position:vector(s.bodyStates,i*6),velocity:vector(s.bodyStates,i*6+3)}));
  this.vessels.clear();s.vesselIds.forEach((id,i)=>{const o=i*13;this.vessels.set(id,{id,primaryBodyId:s.vesselPrimaryIds[i],position:vector(s.vesselStates,o),velocity:vector(s.vesselStates,o+3),relativePosition:vector(s.vesselStates,o+6),relativeVelocity:vector(s.vesselStates,o+9),massKg:s.vesselStates[o+12],lastPrimarySwitch:JSON.parse(s.vesselLastPrimarySwitchJson[i]),primaryBodyHistory:JSON.parse(s.vesselPrimaryHistoryJson[i])});});
 }
 async addVessel(d:{id:string;primaryBodyId:string;position:V3;velocity:V3;massKg?:number}):Promise<VesselSnapshot>{
  await this.bridge.addVessel({id:d.id,primaryBodyId:d.primaryBodyId,position:[d.position.x,d.position.y,d.position.z],velocity:[d.velocity.x,d.velocity.y,d.velocity.z],massKg:d.massKg??1000});
  await this.refresh(await this.bridge.snapshot());return this.vessels.get(d.id)!;
 }
 getBodyState(id:string):PhysicsState{const s=this.bodyStates.get(id);if(!s)throw new Error('Unknown body state: '+id);return s;}
 getVesselState(id:string):VesselSnapshot{const s=this.vessels.get(id);if(!s)throw new Error('Unknown vessel: '+id);return s;}
 getSphereOfInfluence(id:string):number|null{return this.sphereOfInfluence.get(id)??null;}
 async setTimeScale(v:number):Promise<void>{await this.bridge.setTimeScale(v);this.timeScale=v;}
 async setPaused(v:boolean):Promise<void>{await this.bridge.setPaused(v);this.paused=v;}
 async advance(dt:number){const result=await this.bridge.advance(dt);await this.refresh(result.snapshot);this.renderBodyStates.clear();result.snapshot.bodyIds.forEach((id,i)=>this.renderBodyStates.set(id,{position:vector(result.renderBodyStates,i*6),velocity:vector(result.renderBodyStates,i*6+3)}));this.renderVessels.clear();for(const state of result.renderVesselStates){const s=state as unknown as VesselSnapshot;this.renderVessels.set(s.id,s);}return result;}
 async step():Promise<void>{await this.bridge.step();await this.refresh(await this.bridge.snapshot());}
 stateToOrbitalElements(position:V3,velocity:V3,mu:number):Promise<Float64Array>{return this.bridge.stateToOrbitalElements([position.x,position.y,position.z],[velocity.x,velocity.y,velocity.z],mu);}
 gravitationalParameter(id:string):Promise<number>{return this.bridge.gravitationalParameter(id);}
 circularOrbitSpeed(id:string,radiusM:number):Promise<number>{return this.bridge.circularOrbitSpeed(id,radiusM);}
 thrustToWeightRatio(thrustN:number,massKg:number,gravityMS2:number):Promise<number>{return this.bridge.thrustToWeightRatio(thrustN,massKg,gravityMS2);}
 conicElementsToState(p:number,e:number,i:number,node:number,peri:number,nu:number,mu:number):Promise<Float64Array>{return this.bridge.conicElementsToState(p,e,i,node,peri,nu,mu);}
 hohmannTransfer(primaryMu:number,initialRadiusM:number,targetRadiusM:number):Promise<Record<string,number>>{return this.bridge.hohmannTransfer(primaryMu,initialRadiusM,targetRadiusM);}
 planeChangeDeltaV(speedMS:number,angleRadians:number):Promise<number>{return this.bridge.planeChangeDeltaV(speedMS,angleRadians);}
 orbitalPeriod(a:number,mu:number):Promise<number>{return this.bridge.orbitalPeriod(a,mu);}
 async applyBurn(id:string,direction:readonly [number,number,number],dv:number,engine:{vacuumThrustN:number;seaLevelThrustN:number;ispSeconds:number},dryMassKg:number){const result=await this.bridge.applyBurn(id,direction,dv,engine,dryMassKg);await this.refresh(await this.bridge.snapshot());return result;}
 async applyManeuver(id:string,direction:readonly [number,number,number],dv:number):Promise<void>{await this.bridge.applyManeuver(id,direction,dv);await this.refresh(await this.bridge.snapshot());}
 async dispose():Promise<void>{await this.bridge.dispose();}
}
