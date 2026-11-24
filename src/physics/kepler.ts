import { assertPositiveFinite } from './constants.ts';
import type { KeplerPropagationInput, PropagatedState, Vector3 } from '../types/physics.ts';
import { add,dot,magnitude,scale,vector3 } from './vector3.ts';
import { stumpffC,stumpffS } from './stumpff.ts';
/** Universal-variable two-body propagation. SI inputs: m, m/s, s, m^3/s^2. */
export function propagateKepler({position,velocity,mu,deltaTimeSeconds,tolerance=1e-10,maxIterations=100}: KeplerPropagationInput): PropagatedState {
 assertPositiveFinite(mu,'mu');
 if(!Number.isFinite(deltaTimeSeconds))throw new TypeError('deltaTimeSeconds must be finite.');
 if(!Number.isFinite(tolerance)||tolerance<=0)throw new RangeError('tolerance must be positive.');
 if(!Number.isInteger(maxIterations)||maxIterations<1)throw new RangeError('maxIterations must be positive.');
 const r0=magnitude(position);if(r0===0)throw new RangeError('Initial position cannot be the primary centre.');
 if(deltaTimeSeconds===0)return {position:vector3(position.x,position.y,position.z),velocity:vector3(velocity.x,velocity.y,velocity.z),iterations:0};
 const sqrtMu=Math.sqrt(mu),vr0=dot(position,velocity)/r0,alpha=2/r0-dot(velocity,velocity)/mu,da=alpha*r0;
 let chi=Math.abs(da)>1e-8?sqrtMu*Math.abs(alpha)*deltaTimeSeconds:sqrtMu*deltaTimeSeconds/r0;
 if(da < -1e-8){const sign=Math.sign(deltaTimeSeconds),den=vr0+sign*Math.sqrt(-mu/alpha)*(1-r0*alpha),arg=(-2*mu*alpha*deltaTimeSeconds)/den;if(arg>0&&Number.isFinite(arg))chi=sign*Math.sqrt(-1/alpha)*Math.log(arg);}
 let converged=false,iterations=0;
 for(;iterations<maxIterations;iterations++){
  const z=alpha*chi*chi,C=stumpffC(z),S=stumpffS(z);
  const F=(r0*vr0/sqrtMu)*chi*chi*C+(1-alpha*r0)*chi*chi*chi*S+r0*chi-sqrtMu*deltaTimeSeconds;
  const dF=(r0*vr0/sqrtMu)*chi*(1-z*S)+(1-alpha*r0)*chi*chi*C+r0;
  if(!Number.isFinite(F)||!Number.isFinite(dF)||dF===0)break;
  const correction=F/dF;chi-=correction;
  if(Math.abs(correction)<=tolerance*Math.max(1,Math.abs(chi))){converged=true;iterations++;break;}
 }
 if(!converged)throw new Error('Kepler universal-variable solver did not converge after '+iterations+' iterations.');
 const z=alpha*chi*chi,C=stumpffC(z),S=stumpffS(z),f=1-chi*chi*C/r0,g=deltaTimeSeconds-chi*chi*chi*S/sqrtMu;
 const nextPosition=add(scale(position,f),scale(velocity,g)),rn=magnitude(nextPosition);
 if(rn===0)throw new Error('Propagation produced zero radius.');
 const fdot=(sqrtMu/(rn*r0))*(alpha*chi*chi*chi*S-chi),gdot=1-chi*chi*C/rn;
 return {position:nextPosition,velocity:add(scale(position,fdot),scale(velocity,gdot)),iterations};
}
export function gravitationalAcceleration(position: Vector3, mu: number): Vector3 {assertPositiveFinite(mu,'mu');const r=magnitude(position);if(r===0)throw new RangeError('Acceleration undefined at point-mass centre.');return scale(position,-mu/(r*r*r));}
export function specificOrbitalEnergy(position: Vector3, velocity: Vector3, mu: number): number {assertPositiveFinite(mu,'mu');const r=magnitude(position);if(r===0)throw new RangeError('Energy undefined at point-mass centre.');return 0.5*dot(velocity,velocity)-mu/r;}