/** Deterministic 3D procedural noise. Coordinates are unit-sphere vectors, so cube/sphere seams cannot form. */
export function hashUint(value:number):number{
 let x=value>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return x>>>0;
}
export function stableSeed(value:string|number):number{
 if(typeof value==='number')return hashUint(Math.floor(value));
 let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return hashUint(h);
}
export function hash3(x:number,y:number,z:number,seed=0):number{
 let h=hashUint((Math.imul(x|0,0x1f123bb5)^Math.imul(y|0,0x5f356495)^Math.imul(z|0,0x6c8e9cf5)^seed)>>>0);
 return h/4294967295;
}
const fade=(t:number)=>t*t*t*(t*(t*6-15)+10);
export function valueNoise3(x:number,y:number,z:number,seed=0):number{
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=fade(x-ix),fy=fade(y-iy),fz=fade(z-iz);
 const a=(dx:number,dy:number,dz:number)=>hash3(ix+dx,iy+dy,iz+dz,seed)*2-1;
 const mix=(u:number,v:number,t:number)=>u+(v-u)*t;
 return mix(mix(mix(a(0,0,0),a(1,0,0),fx),mix(a(0,1,0),a(1,1,0),fx),fy),
            mix(mix(a(0,0,1),a(1,0,1),fx),mix(a(0,1,1),a(1,1,1),fx),fy),fz);
}

// Градієнтний 3D Perlin noise з детермінованими напрямками на вузлах ґратки.
const GRADIENTS:readonly (readonly [number,number,number])[]=[
 [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],
 [1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
];
export function perlin3(x:number,y:number,z:number,seed=0):number{
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
 const u=fade(fx),v=fade(fy),w=fade(fz);
 const dot=(dx:number,dy:number,dz:number,cx:number,cy:number,cz:number)=>{
  const g=GRADIENTS[Math.floor(hash3(cx,cy,cz,seed)*GRADIENTS.length)%GRADIENTS.length];
  return g[0]*(dx)+g[1]*(dy)+g[2]*(dz);
 };
 const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
 const x00=mix(dot(fx,fy,fz,ix,iy,iz),dot(fx-1,fy,fz,ix+1,iy,iz),u);
 const x10=mix(dot(fx,fy-1,fz,ix,iy+1,iz),dot(fx-1,fy-1,fz,ix+1,iy+1,iz),u);
 const x01=mix(dot(fx,fy,fz-1,ix,iy,iz+1),dot(fx-1,fy,fz-1,ix+1,iy,iz+1),u);
 const x11=mix(dot(fx,fy-1,fz-1,ix,iy+1,iz+1),dot(fx-1,fy-1,fz-1,ix+1,iy+1,iz+1),u);
 return Math.max(0,Math.min(1,.5+(mix(mix(x00,x10,v),mix(x01,x11,v),w)*.5)));
}
export function fbmPerlin3(x:number,y:number,z:number,seed=0,octaves=5):number{
 let sum=0,amplitude=.5,norm=0,frequency=1;
 for(let i=0;i<octaves;i++){sum+=perlin3(x*frequency,y*frequency,z*frequency,hashUint(seed+i*3571))*amplitude;norm+=amplitude;frequency*=2.01;amplitude*=.5;}
 return sum/norm;
}

export function fbm3(x:number,y:number,z:number,seed=0,octaves=5):number{
 let sum=0,amplitude=.5,norm=0,frequency=1;
 for(let i=0;i<octaves;i++){sum+=valueNoise3(x*frequency,y*frequency,z*frequency,hashUint(seed+i*1013))*amplitude;norm+=amplitude;frequency*=2.03;amplitude*=.5;}
 return sum/norm;
}
export function ridged3(x:number,y:number,z:number,seed=0,octaves=5):number{
 let sum=0,amplitude=.5,norm=0,frequency=1;
 for(let i=0;i<octaves;i++){const n=1-Math.abs(valueNoise3(x*frequency,y*frequency,z*frequency,hashUint(seed+i*7919)));sum+=n*n*amplitude;norm+=amplitude;frequency*=2.07;amplitude*=.5;}
 return sum/norm;
}
export function worley3(x:number,y:number,z:number,seed=0):number{
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let nearest=Infinity;
 for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  const cx=ix+dx,cy=iy+dy,cz=iz+dz;
  const px=cx+hash3(cx,cy,cz,seed),py=cy+hash3(cx+19,cy-7,cz+3,seed),pz=cz+hash3(cx-11,cy+5,cz+23,seed);
  const d=(px-x)**2+(py-y)**2+(pz-z)**2;if(d<nearest)nearest=d;
 }
 return Math.sqrt(nearest)/1.7320508075688772;
}
export function domainWarp3(x:number,y:number,z:number,seed=0,strength=.35):[number,number,number]{
 return [x+valueNoise3(x+17.1,y-3.7,z+8.2,seed)*strength,y+valueNoise3(x-9.2,y+21.4,z+2.6,seed+1)*strength,z+valueNoise3(x+4.8,y+6.1,z-19.3,seed+2)*strength];
}
