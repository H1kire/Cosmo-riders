import { gravitationalParameter,assertPositiveFinite } from './constants.js';
import { isFiniteVector,vector3 } from './vector3.js';
export class CelestialBody {
 constructor({id,name,massKg,meanRadiusM,position=vector3(),velocity=vector3(),parentId=null,semiMajorAxisM=null}){
  if(typeof id!=='string'||!id.trim())throw new TypeError('Body id must be non-empty.');
  if(typeof name!=='string'||!name.trim())throw new TypeError('Body name must be non-empty.');
  assertPositiveFinite(massKg,'massKg');assertPositiveFinite(meanRadiusM,'meanRadiusM');
  if(!isFiniteVector(position)||!isFiniteVector(velocity))throw new TypeError('position and velocity must be finite 3D vectors.');
  if(semiMajorAxisM!==null)assertPositiveFinite(semiMajorAxisM,'semiMajorAxisM');
  Object.assign(this,{id,name,massKg,meanRadiusM,mu:gravitationalParameter(massKg),position,velocity,parentId,semiMajorAxisM});Object.freeze(this);
 }
}