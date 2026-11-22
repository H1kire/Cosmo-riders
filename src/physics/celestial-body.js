import { gravitationalParameter,assertPositiveFinite } from './constants.js';
import { isFiniteVector,vector3 } from './vector3.js';
export class CelestialBody {
 constructor({id,name,massKg,meanRadiusM,position=vector3(),velocity=vector3(),parentId=null,semiMajorAxisM=null,orbitalElements=null}){
  if(typeof id!=='string'||!id.trim())throw new TypeError('Body id must be non-empty.');
  if(typeof name!=='string'||!name.trim())throw new TypeError('Body name must be non-empty.');
  assertPositiveFinite(massKg,'massKg');assertPositiveFinite(meanRadiusM,'meanRadiusM');
  if(!isFiniteVector(position)||!isFiniteVector(velocity))throw new TypeError('position and velocity must be finite 3D vectors.');
  if(semiMajorAxisM!==null)assertPositiveFinite(semiMajorAxisM,'semiMajorAxisM');
  if(orbitalElements!==null){if(!parentId)throw new Error('An orbiting body must have a parentId.');if(!Number.isFinite(orbitalElements.semiMajorAxisM)||orbitalElements.semiMajorAxisM<=0)throw new RangeError('orbitalElements.semiMajorAxisM must be positive.');if(!Number.isFinite(orbitalElements.eccentricity)||orbitalElements.eccentricity<0||orbitalElements.eccentricity>=1)throw new RangeError('orbitalElements.eccentricity must be in [0, 1).');}
  Object.assign(this,{id,name,massKg,meanRadiusM,mu:gravitationalParameter(massKg),position,velocity,parentId,semiMajorAxisM:semiMajorAxisM??orbitalElements?.semiMajorAxisM??null,orbitalElements:orbitalElements?Object.freeze({...orbitalElements}):null});Object.freeze(this);
 }
}