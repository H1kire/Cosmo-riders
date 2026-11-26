import type {AdvanceResult,PhysicsCommand,PhysicsResponse,PhysicsSnapshot} from './physics-protocol.ts';
type Pending={resolve:(value:unknown)=>void;reject:(reason:Error)=>void};
export class PhysicsBridge{
 private readonly worker:Worker;private nextId=1;private readonly pending=new Map<number,Pending>();private disposed=false;
 constructor(){
  this.worker=new Worker(new URL('./physics-worker.ts',import.meta.url),{type:'module',name:'cosmo-physics'});
  this.worker.onmessage=(event:MessageEvent<PhysicsResponse>)=>{
   const message=event.data,pending=this.pending.get(message.id);if(!pending)return;
   this.pending.delete(message.id);
   if(message.ok)pending.resolve(message.result);else pending.reject(new Error(message.error??'Physics Worker command failed.'));
  };
  this.worker.onerror=event=>{
   event.preventDefault?.();
   this.failPending(new Error(event.message||'Physics Worker failed.'));
   this.disposed=true;this.worker.terminate();
  };
  this.worker.onmessageerror=()=>{
   this.failPending(new Error('Physics Worker returned a message that could not be deserialized.'));
   this.disposed=true;this.worker.terminate();
  };
 }
 private failPending(error:Error):void{
  for(const pending of this.pending.values())pending.reject(error);
  this.pending.clear();
 }
 private request<T>(command:PhysicsCommand):Promise<T>{
  if(this.disposed)return Promise.reject(new Error('PhysicsBridge disposed.'));
  const id=this.nextId++;
  return new Promise<T>((resolve,reject)=>{
   this.pending.set(id,{resolve:resolve as (value:unknown)=>void,reject});
   try{this.worker.postMessage({id,command});}
   catch(error){this.pending.delete(id);reject(error instanceof Error?error:new Error(String(error)));}
  });
 }
 initialize(catalog:readonly Record<string,unknown>[],options:Record<string,number>={}):Promise<void>{return this.request({type:'initialize',catalog,options});}
 enableNBody():Promise<void>{return this.request({type:'enable-n-body'});}
 nBodyEnabled():Promise<boolean>{return this.request({type:'n-body-status'});}
 advance(realDeltaSeconds:number):Promise<AdvanceResult>{return this.request({type:'advance',realDeltaSeconds});}
 step():Promise<PhysicsSnapshot>{return this.request({type:'step'});}
 setTimeScale(value:number):Promise<void>{return this.request({type:'set-time-scale',value});}
 setPaused(value:boolean):Promise<void>{return this.request({type:'set-paused',value});}
 addVessel(vessel:Record<string,unknown>):Promise<void>{return this.request({type:'add-vessel',vessel});}
 addEngine(vesselId:string,engine:Record<string,unknown>):Promise<void>{return this.request({type:'add-engine',vesselId,engine});}
 startEngineBurn(vesselId:string,engineId:string,durationSeconds:number):Promise<void>{return this.request({type:'engine-burn',vesselId,engineId,durationSeconds});}
 setEngineEnabled(vesselId:string,engineId:string,enabled:boolean):Promise<void>{return this.request({type:'engine-enabled',vesselId,engineId,enabled});}
 setEngineThrottle(vesselId:string,engineId:string,throttle:number):Promise<void>{return this.request({type:'engine-throttle',vesselId,engineId,throttle});}
 setEngineDirection(vesselId:string,engineId:string,direction:readonly [number,number,number]):Promise<void>{return this.request({type:'engine-direction',vesselId,engineId,direction});}
 propulsionState(vesselId:string):Promise<Record<string,unknown>>{return this.request({type:'propulsion-state',vesselId});}
 applyManeuver(vesselId:string,direction:readonly [number,number,number],deltaVMS:number):Promise<void>{return this.request({type:'maneuver',vesselId,direction,deltaVMS});}
 applyBurn(vesselId:string,direction:readonly [number,number,number],deltaVMS:number,engine:{vacuumThrustN:number;seaLevelThrustN:number;ispSeconds:number},dryMassKg:number,ambientPressurePa=0,referencePressurePa=101325):Promise<Record<string,number>>{return this.request({type:'burn',vesselId,direction,deltaVMS,vacuumThrustN:engine.vacuumThrustN,seaLevelThrustN:engine.seaLevelThrustN,ispSeconds:engine.ispSeconds,ambientPressurePa,referencePressurePa,dryMassKg});}
 gravitationalParameter(bodyId:string):Promise<number>{return this.request({type:'gravitational-parameter',bodyId});}
 circularOrbitSpeed(bodyId:string,radiusM:number):Promise<number>{return this.request({type:'circular-orbit-speed',bodyId,radiusM});}
 thrustToWeightRatio(thrustN:number,massKg:number,gravityMS2:number):Promise<number>{return this.request({type:'thrust-to-weight',thrustN,massKg,gravityMS2});}
 orbitPath(bodyId:string,segments:number):Promise<Float64Array>{return this.request({type:'orbit-path',bodyId,segments});}
 snapshot():Promise<PhysicsSnapshot>{return this.request({type:'snapshot'});}
 bodyStatesAt(timeSeconds:number):Promise<Float64Array>{return this.request({type:'body-states-at',timeSeconds});}
 vesselState(id:string):Promise<Record<string,unknown>>{return this.request({type:'vessel-state',id});}
 vesselStateAt(id:string,timeSeconds:number,bodyStates:Float64Array):Promise<Record<string,unknown>>{return this.request({type:'vessel-state-at',id,timeSeconds,bodyStates});}
 sphereOfInfluence(bodyId:string):Promise<number|null>{return this.request({type:'sphere-of-influence',bodyId});}
 rotationAngleAt(bodyId:string,timeSeconds:number):Promise<number>{return this.request({type:'rotation-angle',bodyId,timeSeconds});}
 stateToOrbitalElements(position:readonly [number,number,number],velocity:readonly [number,number,number],mu:number):Promise<Float64Array>{return this.request({type:'state-to-elements',position,velocity,mu});}
 conicElementsToState(semilatusRectumM:number,eccentricity:number,inclination:number,longitudeAscendingNode:number,argumentOfPeriapsis:number,trueAnomaly:number,mu:number):Promise<Float64Array>{return this.request({type:'conic-elements-to-state',semilatusRectumM,eccentricity,inclination,longitudeAscendingNode,argumentOfPeriapsis,trueAnomaly,mu});}
 hohmannTransfer(primaryMu:number,initialRadiusM:number,targetRadiusM:number):Promise<Record<string,number>>{return this.request({type:'hohmann-transfer',primaryMu,initialRadiusM,targetRadiusM});}
 planeChangeDeltaV(speedMS:number,angleRadians:number):Promise<number>{return this.request({type:'plane-change',speedMS,angleRadians});}
 orbitalPeriod(semiMajorAxisM:number,mu:number):Promise<number>{return this.request({type:'orbital-period',semiMajorAxisM,mu});}
 async dispose():Promise<void>{if(this.disposed)return;try{await this.request<boolean>({type:'dispose'});}finally{this.disposed=true;this.worker.terminate();this.failPending(new Error('PhysicsBridge disposed.'));}}
}
