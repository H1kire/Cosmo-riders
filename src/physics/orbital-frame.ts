import type { CelestialBody } from './celestial-body.ts';
import type { OrbitalState } from '../types/physics.ts';

/** Gravitational parameter for the relative two-body problem. */
export function relativeGravitationalParameter(body:CelestialBody,parent:CelestialBody):number {
 return body.mu+parent.mu;
}

/** Перетворює parent-equator або Laplace-plane елементи до спільної екліптичної інерціальної системи. */
export function rotateStateToParentEquator(state:OrbitalState,body:CelestialBody,parent:CelestialBody):OrbitalState {
 if(body.orbitalReferenceFrame==='ecliptic')return state;
 const ra=body.orbitalReferenceFrame==='laplace'?body.orbitalPlanePoleRightAscensionRad:parent.poleRightAscensionRad;
 const dec=body.orbitalReferenceFrame==='laplace'?body.orbitalPlanePoleDeclinationRad:parent.poleDeclinationRad;
 if(ra===null||dec===null)return state;
 const epsilon=23.4392911*Math.PI/180;
 const pole=[Math.cos(dec)*Math.cos(ra),Math.cos(epsilon)*Math.cos(dec)*Math.sin(ra)+Math.sin(epsilon)*Math.sin(dec),-Math.sin(epsilon)*Math.cos(dec)*Math.sin(ra)+Math.cos(epsilon)*Math.sin(dec)];
 const normalize=(v:number[])=>{const m=Math.hypot(...v)||1;return v.map(x=>x/m);};
 const x=normalize([1-pole[0]*pole[0],-pole[1]*pole[0],-pole[2]*pole[0]]);
 const y=normalize([pole[1]*x[2]-pole[2]*x[1],pole[2]*x[0]-pole[0]*x[2],pole[0]*x[1]-pole[1]*x[0]]);
 const transform=(v:{x:number;y:number;z:number})=>({x:x[0]*v.x+y[0]*v.y+pole[0]*v.z,y:x[1]*v.x+y[1]*v.y+pole[1]*v.z,z:x[2]*v.x+y[2]*v.y+pole[2]*v.z});
 return {position:transform(state.position),velocity:transform(state.velocity)};
}

/** @deprecated Use rotateStateToOrbitalReferenceFrame; retained for existing callers. */
export const rotateStateToParentEquator=rotateStateToOrbitalReferenceFrame;
