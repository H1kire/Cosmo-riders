import init,{create_physics_world,state_to_orbital_elements,conic_elements_to_state,thrust_to_weight_ratio,hohmann_transfer,plane_change_delta_v,orbital_period} from '../pkg/cosmo_core.js';
import type {PhysicsRequest,PhysicsResponse,PhysicsSnapshot} from './physics-protocol.ts';
type Handle=ReturnType<typeof create_physics_world>;
const scope=self as unknown as {onmessage:((event:MessageEvent<PhysicsRequest>)=>void)|null;postMessage:(value:unknown,transfer?:Transferable[])=>void};
let world:Handle|null=null,initialized:Promise<void>|null=null;
async function ensureWasm(){if(!initialized)initialized=init().then(()=>undefined);await initialized;}
function live():Handle{if(!world)throw new Error('Physics Worker is not initialized.');return world;}
function transfers(value:unknown):Transferable[]{const out:Transferable[]=[];const visit=(item:unknown)=>{if(item instanceof Float64Array&&item.buffer instanceof ArrayBuffer){out.push(item.buffer);return;}if(Array.isArray(item)){for(const child of item)visit(child);return;}if(item&&typeof item==='object')for(const child of Object.values(item))visit(child);};visit(value);return [...new Set(out)];}
function reply(id:number,result:unknown){const message:PhysicsResponse={id,ok:true,result};scope.postMessage(message,transfers(result));}
scope.onmessage=async(event:MessageEvent<PhysicsRequest>)=>{
 const{id,command}=event.data;
 try{let result:unknown;
 switch(command.type){
 case'initialize':if(world)throw new Error('Physics Worker already owns a PhysicsWorld.');await ensureWasm();world=create_physics_world(JSON.stringify(command.catalog),JSON.stringify(command.options??{}));result=true;break;
 case'enable-n-body':live().enable_n_body();result=true;break;
 case'n-body-status':result=live().is_n_body_enabled();break;
 case'advance':{const w=live(),steps=w.advance_simulation(command.realDeltaSeconds),snapshot=w.get_physics_snapshot() as PhysicsSnapshot,renderTime=snapshot.simulationTimeSeconds+(snapshot.paused?0:snapshot.accumulatorSeconds),renderBodyStates=w.get_body_states_at(renderTime),renderRotationAngles=w.get_rotation_angles_at(renderTime),renderVesselStates=snapshot.vesselIds.map(id=>JSON.parse(w.get_vessel_state_at(id,renderTime,renderBodyStates)));result={steps,snapshot,renderBodyStates,renderRotationAngles,renderVesselStates};break;}
 case'step':live().step_simulation();result=live().get_physics_snapshot();break;
 case'set-time-scale':live().set_time_scale(command.value);result=true;break;
 case'set-paused':live().set_paused(command.value);result=true;break;
 case'add-vessel':live().add_vessel(JSON.stringify(command.vessel));result=true;break;
 case'add-engine':live().add_engine(command.vesselId,JSON.stringify(command.engine));result=true;break;
 case'engine-enabled':live().set_engine_enabled(command.vesselId,command.engineId,command.enabled);result=true;break;
 case'engine-throttle':live().set_engine_throttle(command.vesselId,command.engineId,command.throttle);result=true;break;
 case'engine-direction':live().set_engine_direction(command.vesselId,command.engineId,new Float64Array(command.direction));result=true;break;
 case'propulsion-state':result=JSON.parse(live().get_propulsion_state(command.vesselId));break;
 case'maneuver':live().apply_maneuver(command.vesselId,new Float64Array(command.direction),command.deltaVMS);result=true;break;
 case'burn':result=JSON.parse(live().apply_idealized_burn(command.vesselId,new Float64Array(command.direction),command.deltaVMS,command.vacuumThrustN,command.seaLevelThrustN,command.ispSeconds,command.ambientPressurePa,command.referencePressurePa,command.dryMassKg));break;
 case'gravitational-parameter':result=live().get_gravitational_parameter(command.bodyId);break;
 case'circular-orbit-speed':result=live().get_circular_orbit_speed(command.bodyId,command.radiusM);break;
 case'thrust-to-weight':result=thrust_to_weight_ratio(command.thrustN,command.massKg,command.gravityMS2);break;
 case'orbit-path':result=live().get_orbit_path(command.bodyId,command.segments);break;
 case'snapshot':result=live().get_physics_snapshot();break;
 case'body-states-at':result=live().get_body_states_at(command.timeSeconds);break;
 case'vessel-state':result=JSON.parse(live().get_vessel_state(command.id));break;
 case'vessel-state-at':result=JSON.parse(live().get_vessel_state_at(command.id,command.timeSeconds,command.bodyStates));break;
 case'sphere-of-influence':result=live().get_sphere_of_influence(command.bodyId)??null;break;
 case'rotation-angle':result=live().get_rotation_angle_at(command.bodyId,command.timeSeconds);break;
 case'state-to-elements':result=state_to_orbital_elements(new Float64Array(command.position),new Float64Array(command.velocity),command.mu);break;
 case'conic-elements-to-state':result=conic_elements_to_state(command.semilatusRectumM,command.eccentricity,command.inclination,command.longitudeAscendingNode,command.argumentOfPeriapsis,command.trueAnomaly,command.mu);break;
 case'hohmann-transfer':result=JSON.parse(hohmann_transfer(command.primaryMu,command.initialRadiusM,command.targetRadiusM));break;
 case'plane-change':result=plane_change_delta_v(command.speedMS,command.angleRadians);break;
 case'orbital-period':result=orbital_period(command.semiMajorAxisM,command.mu);break;
 case'dispose':world?.dispose_physics_world();world=null;result=true;break;
 }
 reply(id,result);
 }catch(error){const message:PhysicsResponse={id,ok:false,error:error instanceof Error?error.message:String(error)};scope.postMessage(message);}
};
