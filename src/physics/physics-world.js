import { assertPositiveFinite } from './constants.js';
import { add,subtract,magnitude } from './vector3.js';
import { propagateKepler } from './kepler.js';
import { orbitalElementsToState } from './orbital-state.js';
import { sphereOfInfluence } from './orbital-elements.js';

/** Fixed-step hierarchical ephemeris + patched-conic vessel propagation.
 * Simulation epoch is J2000.0; each orbit is a two-body Kepler segment.
 */
export class PhysicsWorld {
 constructor({fixedStepSeconds=60,maxSubSteps=10000,soiEnterFactor=0.9,soiExitFactor=1.1}={}){
  assertPositiveFinite(fixedStepSeconds,'fixedStepSeconds');
  if(!Number.isInteger(maxSubSteps)||maxSubSteps<1)throw new RangeError('maxSubSteps must be positive.');
  if(!(soiEnterFactor>0&&soiEnterFactor<1))throw new RangeError('soiEnterFactor must be between 0 and 1.');
  if(!(soiExitFactor>1))throw new RangeError('soiExitFactor must be greater than 1.');
  Object.assign(this,{fixedStepSeconds,maxSubSteps,soiEnterFactor,soiExitFactor,timeScale:1,paused:false,simulationTimeSeconds:0,accumulator:0,bodies:new Map(),bodyStates:new Map(),bodyInitialRelativeStates:new Map(),vessels:new Map(),initialized:false});
 }
 addBody(body){
  if(!body?.id||!Number.isFinite(body.mu))throw new TypeError('Expected a valid CelestialBody.');
  if(this.bodies.has(body.id))throw new Error('Duplicate body id: '+body.id);
  if(body.parentId&&!this.bodies.has(body.parentId))throw new Error('Parent body not found: '+body.parentId);
  if(!body.parentId&&this.bodies.size>0)throw new Error('Only one root body is supported in this world.');
  if(this.initialized)throw new Error('Cannot add bodies after ephemeris initialization.');
  this.bodies.set(body.id,body);
  return body;
 }
 initializeEphemerides(){
  if(this.initialized)return;
  for(const body of this.bodies.values()){
   if(!body.parentId){this.bodyStates.set(body.id,{position:body.position,velocity:body.velocity});continue;}
   const parent=this.bodies.get(body.parentId);
   if(body.orbitalElements){
    const state=orbitalElementsToState(body.orbitalElements,parent.mu);
    this.bodyInitialRelativeStates.set(body.id,state);
    this.bodyStates.set(body.id,{position:add(this.bodyStates.get(parent.id).position,state.position),velocity:add(this.bodyStates.get(parent.id).velocity,state.velocity)});
   }else{
    const relative={position:subtract(body.position,parent.position),velocity:subtract(body.velocity,parent.velocity)};
    this.bodyInitialRelativeStates.set(body.id,relative);
    this.bodyStates.set(body.id,{position:body.position,velocity:body.velocity});
   }
  }
  this.initialized=true;
 }
 addVessel({id,primaryBodyId,position,velocity}){
  this.initializeEphemerides();
  if(typeof id!=='string'||!id.trim())throw new TypeError('Vessel id must be non-empty.');
  if(this.vessels.has(id))throw new Error('Duplicate vessel id: '+id);
  const primary=this.bodies.get(primaryBodyId);if(!primary)throw new Error('Primary body not found: '+primaryBodyId);
  const primaryState=this.getBodyState(primaryBodyId);
  const relativePosition=subtract(position,primaryState.position),relativeVelocity=subtract(velocity,primaryState.velocity);
  const vessel={id,primaryBodyId,relativePosition,relativeVelocity,position,velocity,lastPrimarySwitch:null};
  this.vessels.set(id,vessel);return vessel;
 }
 setTimeScale(value){if(!Number.isFinite(value)||value<0)throw new RangeError('timeScale must be finite and non-negative.');this.timeScale=value;}
 setPaused(value){this.paused=Boolean(value);}
 getBodyState(id){this.initializeEphemerides();const state=this.bodyStates.get(id);if(!state)throw new Error('Unknown body: '+id);return state;}
 getVesselState(id){const v=this.vessels.get(id);if(!v)throw new Error('Unknown vessel: '+id);return {position:v.position,velocity:v.velocity,primaryBodyId:v.primaryBodyId};}
 getSphereOfInfluence(bodyId){
  const body=this.bodies.get(bodyId);if(!body||!body.parentId||body.semiMajorAxisM===null)return null;
  const parent=this.bodies.get(body.parentId);
  return sphereOfInfluence(body.semiMajorAxisM,body.massKg,parent.massKg);
 }
 updateEphemerides(){
  for(const body of this.bodies.values()){
   if(!body.parentId)continue;
   const parent=this.bodies.get(body.parentId),initial=this.bodyInitialRelativeStates.get(body.id);
   const relative=propagateKepler({position:initial.position,velocity:initial.velocity,mu:parent.mu,deltaTimeSeconds:this.simulationTimeSeconds});
   const parentState=this.bodyStates.get(parent.id);
   this.bodyStates.set(body.id,{position:add(parentState.position,relative.position),velocity:add(parentState.velocity,relative.velocity)});
  }
 }
 choosePatchedConicPrimary(vessel){
  const current=this.bodies.get(vessel.primaryBodyId),currentState=this.getBodyState(current.id);
  if(current.parentId){
   const parent=this.bodies.get(current.parentId),parentState=this.getBodyState(parent.id),soi=this.getSphereOfInfluence(current.id);
   if(soi!==null&&magnitude(subtract(vessel.position,parentState.position))>soi*this.soiExitFactor)return parent;
  }
  let selected=null,selectedSoi=Infinity;
  for(const child of this.bodies.values()){
   if(child.parentId!==current.id)continue;
   const soi=this.getSphereOfInfluence(child.id);if(soi===null)continue;
   const childState=this.getBodyState(child.id),distance=magnitude(subtract(vessel.position,childState.position));
   if(distance<soi*this.soiEnterFactor&&soi<selectedSoi){selected=child;selectedSoi=soi;}
  }
  return selected??current;
 }
 switchPrimary(vessel,nextPrimary){
  if(nextPrimary.id===vessel.primaryBodyId)return false;
  const state=this.getBodyState(nextPrimary.id);
  vessel.relativePosition=subtract(vessel.position,state.position);
  vessel.relativeVelocity=subtract(vessel.velocity,state.velocity);
  vessel.lastPrimarySwitch={from:vessel.primaryBodyId,to:nextPrimary.id,timeSeconds:this.simulationTimeSeconds};
  vessel.primaryBodyId=nextPrimary.id;
  return true;
 }
 step(){
  this.initializeEphemerides();
  this.simulationTimeSeconds+=this.fixedStepSeconds;
  this.updateEphemerides();
  for(const vessel of this.vessels.values()){
   const primary=this.bodies.get(vessel.primaryBodyId),primaryState=this.getBodyState(primary.id);
   const next=propagateKepler({position:vessel.relativePosition,velocity:vessel.relativeVelocity,mu:primary.mu,deltaTimeSeconds:this.fixedStepSeconds});
   vessel.relativePosition=next.position;vessel.relativeVelocity=next.velocity;
   vessel.position=add(primaryState.position,next.position);vessel.velocity=add(primaryState.velocity,next.velocity);
   const nextPrimary=this.choosePatchedConicPrimary(vessel);
   if(nextPrimary.id!==primary.id)this.switchPrimary(vessel,nextPrimary);
  }
 }
 advance(realDeltaSeconds){
  if(!Number.isFinite(realDeltaSeconds)||realDeltaSeconds<0)throw new RangeError('realDeltaSeconds must be finite and non-negative.');
  if(this.paused||this.timeScale===0||realDeltaSeconds===0)return 0;
  this.accumulator+=realDeltaSeconds*this.timeScale;
  const available=Math.floor(this.accumulator/this.fixedStepSeconds);
  if(available>this.maxSubSteps)throw new RangeError('Physics backlog exceeds maxSubSteps; reduce frame delta or time scale.');
  for(let i=0;i<available;i++)this.step();
  this.accumulator-=available*this.fixedStepSeconds;
  return available;
 }
}