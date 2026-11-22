/** Stumpff C(z), S(z) for universal-variable Kepler propagation. */
export function stumpffC(z) {
 if(!Number.isFinite(z)) throw new TypeError('z must be finite.');
 if(Math.abs(z)<1e-8) return 0.5-z/24+z*z/720-z*z*z/40320;
 if(z>0){const q=Math.sqrt(z);return (1-Math.cos(q))/z;}
 const q=Math.sqrt(-z);if(q>350)throw new RangeError('Hyperbolic anomaly exceeds stable numeric range.');
 return (Math.cosh(q)-1)/(-z);
}
export function stumpffS(z) {
 if(!Number.isFinite(z)) throw new TypeError('z must be finite.');
 if(Math.abs(z)<1e-8) return 1/6-z/120+z*z/5040-z*z*z/362880;
 if(z>0){const q=Math.sqrt(z);return (q-Math.sin(q))/(q*q*q);}
 const q=Math.sqrt(-z);if(q>350)throw new RangeError('Hyperbolic anomaly exceeds stable numeric range.');
 return (Math.sinh(q)-q)/(q*q*q);
}