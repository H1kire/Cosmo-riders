import type {AdvanceResult,PhysicsCommand,PhysicsResponse,PhysicsSnapshot} from './physics-protocol.ts';
type Pending={resolve:(value:unknown)=>void;reject:(reason:Error)=>void};
export class PhysicsBridge{
 private readonly worker:Worker;private nextId=1;private readonly pending=new Map<number,Pending>();private disposed=false;
 constructor(){this.worker=new Worker(new URL('./physics-worker.ts',import.meta.url),{type:'module',name:'cosmo-physics'});this.worker.onmessage=(event:MessageEvent<PhysicsResponse>)=>{const m=event.data,p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);if(m.ok)p.resolve(m.result);else p.reject(new Error(m.error??'Physics Worker command failed.'));};this.worker.onerror=event=>{const e=new Error(event.message||'Physics Worker failed.');for(const p of this.pending.values())p.reject(e);this.pending.clear();};}
 private request<T>(command:PhysicsCommand):Promise<T>{if(this.disposed)return Promise.reject(new Error('PhysicsBridge disposed.'));const id=this.nextId++;return new Promise<T>((resolve,reject)=>{this.pending.set(id,{resolve:resolve as (v:unknown)=>void,reject});this.worker.postMessage({id,command});});}
 initialize(catalog:readonly Record<string,unknown>[],options:Record<string,number>={}):Promise<void>{return this.request({type:'initialize',catalog,options});}
 advance(realDeltaSeconds:number):Promise<AdvanceResult>{return this.request({type:'advance',realDeltaSeconds});}
 step():Promise<PhysicsSnapshot>{return this.request({type:'step'});}
 setTimeScale(value:number):Promise<void>{return this.request({type:'set-time-scale',value});}
 setPaused(value:boolean):Promise<void>{return this.request({type:'set-paused',value});}
 addVessel(vessel:Record<string,unknown>):Promise<void>{return this.request({type:'add-vessel',vessel});}
 applyManeuver(vesselId:string,direction:readonly [number,number,number],deltaVMS:number):Promise<void>{return this.request({type:'maneuver',vesselId,direction,deltaVMS});}
 applyBurn(vesselId:string,direction:readonly [number,number,number],deltaVMS:number,engine:{vacuumThrustN:number;seaLevelThrustN:number;ispSeconds:number},dryMassKg:number,ambientPressurePa=0,referencePressurePa=101325):Promise<Record<string,number>>{return this.request({type:'burn',vesselId,direction,deltaVMS,vacuumThrustN:engine.vacuumThrustN,seaLevelThrustN:engine.seaLevelThrustN,ispSeconds:engine.ispSeconds,ambientPressurePa,referencePressurePa,dryMassKg});}
 snapshot():Promise<PhysicsSnapshot>{return this.request({type:'snapshot'});}
 bodyStatesAt(timeSeconds:number):Promise<Float64Array>{return this.request({type:'body-states-at',timeSeconds});}
 vesselState(id:string):Promise<Record<string,unknown>>{return this.request({type:'vessel-state',id});}
 vesselStateAt(id:string,timeSeconds:number,bodyStates:Float64Array):Promise<Record<string,unknown>>{return this.request({type:'vessel-state-at',id,timeSeconds,bodyStates});}
 sphereOfInfluence(bodyId:string):Promise<number|null>{return this.request({type:'sphere-of-influence',bodyId});}
 rotationAngleAt(bodyId:string,timeSeconds:number):Promise<number>{return this.request({type:'rotation-angle',bodyId,timeSeconds});}
 async dispose():Promise<void>{if(this.disposed)return;try{await this.request<boolean>({type:'dispose'});}finally{this.disposed=true;this.worker.terminate();for(const p of this.pending.values())p.reject(new Error('PhysicsBridge disposed.'));this.pending.clear();}}
}
