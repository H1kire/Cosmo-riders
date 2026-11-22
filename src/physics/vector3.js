import { assertFiniteNumber } from './constants.js';
export function vector3(x=0,y=0,z=0) { assertFiniteNumber(x,'x'); assertFiniteNumber(y,'y'); assertFiniteNumber(z,'z'); return Object.freeze({x,y,z}); }
export function fromArray(a) { if (!Array.isArray(a)||a.length!==3) throw new TypeError('Expected a 3-element array.'); return vector3(a[0],a[1],a[2]); }
export function toArray(v) { return [v.x,v.y,v.z]; }
export function add(a,b) { return vector3(a.x+b.x,a.y+b.y,a.z+b.z); }
export function subtract(a,b) { return vector3(a.x-b.x,a.y-b.y,a.z-b.z); }
export function scale(v,k) { assertFiniteNumber(k,'scale'); return vector3(v.x*k,v.y*k,v.z*k); }
export function dot(a,b) { return a.x*b.x+a.y*b.y+a.z*b.z; }
export function cross(a,b) { return vector3(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x); }
export function magnitudeSquared(v) { return dot(v,v); }
export function magnitude(v) { return Math.sqrt(magnitudeSquared(v)); }
export function normalize(v) { const m=magnitude(v); if(m===0) throw new RangeError('Cannot normalize a zero-length vector.'); return scale(v,1/m); }
export function distance(a,b) { return magnitude(subtract(a,b)); }
export function isFiniteVector(v) { return Number.isFinite(v?.x)&&Number.isFinite(v?.y)&&Number.isFinite(v?.z); }