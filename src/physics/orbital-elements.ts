import { assertPositiveFinite } from './constants.ts';
import { cross,dot,magnitude,scale,subtract,vector3 } from './vector3.ts';
const clamp=x=>Math.max(-1,Math.min(1,x));
/** Classical orbital elements from state vectors. All angles are radians. */
export function stateToOrbitalElements(position,velocity,mu){
 assertPositiveFinite(mu,'mu');const r=magnitude(position),v2=dot(velocity,velocity);if(r===0)throw new RangeError('Position cannot be zero.');
 const h=cross(position,velocity),hm=magnitude(h);if(hm===0)throw new RangeError('Radial trajectory has no defined orbital plane.');
 const ev=subtract(scale(cross(velocity,h),1/mu),scale(position,1/r)),e=magnitude(ev),energy=v2/2-mu/r;
 const energyScale=Math.max(v2/2,mu/r,Number.MIN_VALUE),parabolic=Math.abs(energy)<=1e-12*energyScale,a=parabolic?Infinity:-mu/(2*energy);
 const inclination=Math.acos(clamp(h.z/hm)),n=vector3(-h.y,h.x,0),nm=magnitude(n),equatorial=nm<1e-12*hm,circular=e<1e-10;
 const node=equatorial?0:Math.atan2(n.y,n.x);let peri=0,nu=0;
 if(!circular&&!equatorial){peri=Math.acos(clamp(dot(n,ev)/(nm*e)));if(ev.z<0)peri=2*Math.PI-peri;}
 else if(!circular)peri=Math.atan2(ev.y,ev.x);
 if(!circular){nu=Math.acos(clamp(dot(ev,position)/(e*r)));if(dot(position,velocity)<0)nu=2*Math.PI-nu;}
 else if(!equatorial){nu=Math.acos(clamp(dot(n,position)/(nm*r)));if(position.z<0)nu=2*Math.PI-nu;}
 else {nu=Math.atan2(position.y,position.x);if(nu<0)nu+=2*Math.PI;}
 return {semiMajorAxis:a,eccentricity:e,inclination,longitudeAscendingNode:node,argumentOfPeriapsis:peri,trueAnomaly:nu,specificOrbitalEnergy:energy,specificAngularMomentum:hm,isCircular:circular,isEquatorial:equatorial,isParabolic:parabolic,trajectoryType:parabolic?'parabolic':energy<0?'elliptic':'hyperbolic'};
}
export function orbitalPeriod(a,mu){assertPositiveFinite(a,'semiMajorAxis');assertPositiveFinite(mu,'mu');return 2*Math.PI*Math.sqrt(a**3/mu);}
export function sphereOfInfluence(a,satelliteMassKg,primaryMassKg){assertPositiveFinite(a,'semiMajorAxis');assertPositiveFinite(satelliteMassKg,'satelliteMassKg');assertPositiveFinite(primaryMassKg,'primaryMassKg');if(satelliteMassKg>=primaryMassKg)throw new RangeError('Satellite mass must be smaller than primary mass.');return a*(satelliteMassKg/primaryMassKg)**(2/5);}