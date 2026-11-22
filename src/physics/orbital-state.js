import { assertPositiveFinite } from './constants.js';
import { vector3 } from './vector3.js';

const TAU = 2 * Math.PI;
const wrapRadians = value => ((value % TAU) + TAU) % TAU;
function solveEccentricAnomaly(meanAnomaly, eccentricity, tolerance=1e-13) {
  if (!(eccentricity >= 0 && eccentricity < 1)) throw new RangeError('Elliptic eccentricity must be in [0, 1).');
  const M = wrapRadians(meanAnomaly);
  let E = eccentricity < 0.8 ? M : Math.PI;
  for (let i=0; i<50; i++) {
    const f = E - eccentricity*Math.sin(E) - M;
    const derivative = 1 - eccentricity*Math.cos(E);
    const delta = f/derivative;
    E -= delta;
    if (Math.abs(delta) <= tolerance) return E;
  }
  throw new Error('Kepler equation solver did not converge.');
}

/** Convert classical elliptic elements into an inertial state vector.
 * Angles are radians; distances in metres; mu in m^3/s^2.
 * Frame: inertial axes with z normal to the reference plane.
 */
export function orbitalElementsToState({semiMajorAxisM:a,eccentricity:e,inclination:i=0,longitudeAscendingNode:Omega=0,argumentOfPeriapsis:omega=0,meanAnomaly:M=0},mu) {
  assertPositiveFinite(a,'semiMajorAxisM'); assertPositiveFinite(mu,'mu');
  if (!(Number.isFinite(e)&&e>=0&&e<1)) throw new RangeError('This element converter currently supports elliptic eccentricity 0 <= e < 1.');
  for (const [name,value] of Object.entries({inclination:i,longitudeAscendingNode:Omega,argumentOfPeriapsis:omega,meanAnomaly:M})) if(!Number.isFinite(value)) throw new TypeError(name+' must be finite.');
  const E=solveEccentricAnomaly(M,e),cE=Math.cos(E),sE=Math.sin(E),root=Math.sqrt(1-e*e),n=Math.sqrt(mu/(a*a*a));
  const x=a*(cE-e),y=a*root*sE,den=1-e*cE;
  const vx=-a*n*sE/den,vy=a*n*root*cE/den;
  const cO=Math.cos(Omega),sO=Math.sin(Omega),ci=Math.cos(i),si=Math.sin(i),cw=Math.cos(omega),sw=Math.sin(omega);
  const m11=cO*cw-sO*sw*ci,m12=-cO*sw-sO*cw*ci;
  const m21=sO*cw+cO*sw*ci,m22=-sO*sw+cO*cw*ci;
  const m31=sw*si,m32=cw*si;
  return {
    position:vector3(m11*x+m12*y,m21*x+m22*y,m31*x+m32*y),
    velocity:vector3(m11*vx+m12*vy,m21*vx+m22*vy,m31*vx+m32*vy),
    eccentricAnomaly:E
  };
}
