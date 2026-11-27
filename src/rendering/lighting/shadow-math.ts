/** Математика м'яких тіней та перетину променя з площиною кілець. */
export function angularDiskOverlapFraction(sourceRadius:number,occluderRadius:number,separation:number):number{
  if(![sourceRadius,occluderRadius,separation].every(Number.isFinite)||sourceRadius<=0||occluderRadius<=0||separation<0)return 0;
  const r=sourceRadius,q=occluderRadius,d=separation;
  if(d>=r+q)return 0;
  if(d<=Math.abs(r-q))return q>=r?1:Math.min(1,(q*q)/(r*r));
  const x=Math.max(-1,Math.min(1,(d*d+r*r-q*q)/(2*d*r)));
  const y=Math.max(-1,Math.min(1,(d*d+q*q-r*r)/(2*d*q)));
  const area=r*r*Math.acos(x)+q*q*Math.acos(y)-.5*Math.sqrt(Math.max(0,(-d+r+q)*(d+r-q)*(d-r+q)*(d+r+q)));
  return Math.max(0,Math.min(1,area/(Math.PI*r*r)));
}
export function rayPlaneIntersectionDistance(origin:readonly[number,number,number],direction:readonly[number,number,number],planePoint:readonly[number,number,number],planeNormal:readonly[number,number,number]):number|null{
 const denominator=direction[0]*planeNormal[0]+direction[1]*planeNormal[1]+direction[2]*planeNormal[2];
 if(Math.abs(denominator)<1e-9)return null;
 const distance=((planePoint[0]-origin[0])*planeNormal[0]+(planePoint[1]-origin[1])*planeNormal[1]+(planePoint[2]-origin[2])*planeNormal[2])/denominator;
 return distance>1e-9&&Number.isFinite(distance)?distance:null;
}
export function ringShadowVisibility(radialDistance:number,innerRadius:number,outerRadius:number,opacity:number):number{
 if(![radialDistance,innerRadius,outerRadius,opacity].every(Number.isFinite)||innerRadius<0||outerRadius<=innerRadius)return 1;
 if(radialDistance<=innerRadius||radialDistance>=outerRadius)return 1;
 const t=(radialDistance-innerRadius)/(outerRadius-innerRadius),band=.65+.35*Math.sin(t*800);
 return Math.max(0,Math.min(1,1-Math.max(0,Math.min(1,opacity))*band));
}
