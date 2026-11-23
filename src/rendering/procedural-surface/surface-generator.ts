import { stableSeed,fbm3,ridged3,worley3,domainWarp3 } from './noise.ts';

export type SurfaceClass='rocky'|'oceanic'|'icy'|'volcanic'|'gas-giant'|'ice-giant';
export interface SurfaceGenerationProfile{
 id:string;seed:number;class:SurfaceClass;gravityMS2:number;temperatureK:number;pressurePa:number;
 waterFraction:number;iceFraction:number;ironFraction:number;silicateFraction:number;
 tectonicActivity:number;volcanicActivity:number;impactAge:number;erosion:number;rotationFactor:number;
}
export interface SurfaceSample{height:number;albedo:[number,number,number];roughness:number;material:'rock'|'sand'|'metal'|'ice'|'water'|'lava'|'ash';}
export interface SurfaceBodyInput{id:string;massKg:number;meanRadiusM:number;surfaceSeed?:number|null;surface?:Partial<Omit<SurfaceGenerationProfile,'id'|'seed'>>;}

const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function createSurfaceProfile(body:SurfaceBodyInput):SurfaceGenerationProfile{
 const seed=body.surfaceSeed??stableSeed(body.id),gravity=6.67430e-11*body.massKg/(body.meanRadiusM*body.meanRadiusM);
 const known:Record<string,Partial<SurfaceGenerationProfile>>={
  earth:{class:'oceanic',temperatureK:288,pressurePa:101325,waterFraction:.71,iceFraction:.025,ironFraction:.32,silicateFraction:.62,tectonicActivity:.8,volcanicActivity:.32,impactAge:.18,erosion:.78},
  moon:{class:'rocky',temperatureK:220,pressurePa:0,waterFraction:.001,iceFraction:.025,ironFraction:.12,silicateFraction:.82,tectonicActivity:.01,volcanicActivity:.02,impactAge:.92,erosion:0},
  mars:{class:'rocky',temperatureK:210,pressurePa:610,waterFraction:.015,iceFraction:.12,ironFraction:.28,silicateFraction:.67,tectonicActivity:.08,volcanicActivity:.12,impactAge:.65,erosion:.14},
  mercury:{class:'rocky',temperatureK:440,pressurePa:0,waterFraction:0,iceFraction:.01,ironFraction:.68,silicateFraction:.29,tectonicActivity:.01,volcanicActivity:.01,impactAge:.85,erosion:0},
  venus:{class:'rocky',temperatureK:737,pressurePa:9.2e6,waterFraction:0,iceFraction:0,ironFraction:.3,silicateFraction:.68,tectonicActivity:.24,volcanicActivity:.52,impactAge:.36,erosion:.3},
  io:{class:'volcanic',temperatureK:130,pressurePa:0,waterFraction:0,iceFraction:.02,ironFraction:.25,silicateFraction:.55,tectonicActivity:.25,volcanicActivity:1,impactAge:.05,erosion:.02},
  europa:{class:'icy',temperatureK:102,pressurePa:0,waterFraction:.35,iceFraction:.8,ironFraction:.15,silicateFraction:.15,tectonicActivity:.18,volcanicActivity:.02,impactAge:.3,erosion:.08},
  titan:{class:'icy',temperatureK:94,pressurePa:146000,waterFraction:.02,iceFraction:.7,ironFraction:.08,silicateFraction:.2,tectonicActivity:.12,volcanicActivity:.04,impactAge:.42,erosion:.55},
  jupiter:{class:'gas-giant',temperatureK:165,pressurePa:1e5,waterFraction:.08,iceFraction:0,ironFraction:.0,silicateFraction:.0,tectonicActivity:0,volcanicActivity:0,impactAge:.1,erosion:.4},
  saturn:{class:'gas-giant',temperatureK:134,pressurePa:1e5,waterFraction:.08,iceFraction:0,ironFraction:0,silicateFraction:0,tectonicActivity:0,volcanicActivity:0,impactAge:.1,erosion:.4},
  uranus:{class:'ice-giant',temperatureK:76,pressurePa:1e5,waterFraction:.35,iceFraction:.5,ironFraction:0,silicateFraction:0,tectonicActivity:0,volcanicActivity:0,impactAge:.1,erosion:.35},
  neptune:{class:'ice-giant',temperatureK:72,pressurePa:1e5,waterFraction:.35,iceFraction:.5,ironFraction:0,silicateFraction:0,tectonicActivity:0,volcanicActivity:0,impactAge:.1,erosion:.35}
 };
 const fallback:Partial<SurfaceGenerationProfile>=gravity<2?{class:'icy',temperatureK:160,waterFraction:.18,iceFraction:.4,ironFraction:.18,silicateFraction:.38,tectonicActivity:.12,volcanicActivity:.08,impactAge:.55,erosion:.15}:{class:'rocky',temperatureK:260,waterFraction:.08,iceFraction:.08,ironFraction:.28,silicateFraction:.58,tectonicActivity:.25,volcanicActivity:.18,impactAge:.48,erosion:.3};
 const base={...fallback,...known[body.id.toLowerCase()],...body.surface};
 return {id:body.id,seed,class:base.class??'rocky',gravityMS2:gravity,temperatureK:base.temperatureK??260,pressurePa:base.pressurePa??0,waterFraction:clamp(base.waterFraction??.08),iceFraction:clamp(base.iceFraction??.08),ironFraction:clamp(base.ironFraction??.28),silicateFraction:clamp(base.silicateFraction??.58),tectonicActivity:clamp(base.tectonicActivity??.25),volcanicActivity:clamp(base.volcanicActivity??.18),impactAge:clamp(base.impactAge??.48),erosion:clamp(base.erosion??.3),rotationFactor:clamp(base.rotationFactor??.5)};
}
export function sampleSurfaceHeight(direction:[number,number,number],profile:SurfaceGenerationProfile):number{
 const magnitude=Math.hypot(...direction)||1,x=direction[0]/magnitude,y=direction[1]/magnitude,z=direction[2]/magnitude,seed=profile.seed;
 const warped=domainWarp3(x*3.2,y*3.2,z*3.2,seed,.42),[wx,wy,wz]=warped;
 const continent=fbm3(wx,wy,wz,seed,6),regional=fbm3(x*13,y*13,z*13,seed+17,5);
 const ridges=ridged3(wx*21,wy*21,wz*21,seed+31,5);
 const tectonic=ridged3(x*5+regional,y*5,z*5,seed+89,4)*profile.tectonicActivity;
 const volcanic=fbm3(x*11,y*11,z*11,seed+103,4)*profile.volcanicActivity;
 let height=continent*.28+regional*.12+ridges*.12+tectonic*.16+volcanic*.08;
 const weathering=clamp(profile.erosion+clamp(Math.log10(1+profile.pressurePa)/7)*smooth(150,300,profile.temperatureK)*.18);
 height*=1-weathering*.45;
 return height*clamp(1.4/Math.sqrt(Math.max(.1,profile.gravityMS2)),.55,1.8);
}
export function sampleSurface(direction:[number,number,number],profile:SurfaceGenerationProfile):SurfaceSample{
 const m=Math.hypot(...direction)||1,[x,y,z]=direction.map(v=>v/m) as [number,number,number],s=profile.seed;
 const warped=domainWarp3(x*3.2,y*3.2,z*3.2,s,.42),[wx,wy,wz]=warped;
 const continent=fbm3(wx,wy,wz,s,6),regional=fbm3(x*13,y*13,z*13,s+17,5);
 const ridges=ridged3(wx*21,wy*21,wz*21,s+31,5),cells=worley3(x*68,y*68,z*68,s+47);
 const craterField=worley3(x*9,y*9,z*9,s+71),crater=smooth(.12,.3,craterField)*(1-smooth(.34,.52,craterField))*profile.impactAge;
 const tectonic=ridged3(x*5+regional,y*5,z*5,s+89,4)*profile.tectonicActivity;
 const volcanic=fbm3(x*11,y*11,z*11,s+103,4)*profile.volcanicActivity;
 let height=continent*.28+regional*.12+ridges*.12+tectonic*.16+volcanic*.08-crater*.16;
 const atmosphericWeathering=clamp(Math.log10(1+profile.pressurePa)/7)*smooth(150,300,profile.temperatureK)*.18;
 height*=1-clamp(profile.erosion+atmosphericWeathering)*.45;
 height*=clamp(1.4/Math.sqrt(Math.max(.1,profile.gravityMS2)),.55,1.8);
 const latitude=Math.abs(y),polar=smooth(.78,.98,latitude),cold=smooth(300,150,profile.temperatureK);
 const thermalIce=cold*clamp(profile.pressurePa/611)*.65,effectiveIce=Math.max(profile.iceFraction,thermalIce);
 let albedo:[number,number,number]=[.32,.29,.25],roughness=.88,material:SurfaceSample['material']='rock';
 const mineral=fbm3(wx*32,wy*32,wz*32,s+131,4),metal=profile.ironFraction;
 if(profile.class==='gas-giant'||profile.class==='ice-giant'){
  const bands=Math.sin((y+regional*.035)*95+continent*3),storm=fbm3(x*19,y*7,z*19,s+151,5);
  albedo=profile.class==='gas-giant'?[.48+bands*.11,.31+bands*.09,.19+bands*.07]:[.22+bands*.035,.48+bands*.08,.58+bands*.09];
  const vortex=smooth(.72,.91,storm)*.35;albedo=[albedo[0]+vortex,albedo[1]+vortex*.45,albedo[2]+vortex*.2];roughness=.68;material='ash';
 }else if(profile.class==='icy'||effectiveIce>.5){
  const crack=smooth(.76,.94,cells)*(1-profile.erosion*.5);albedo=[.62+polar*.22-crack*.15,.72+polar*.18-crack*.12,.78+polar*.16-crack*.08];roughness=.34;material='ice';
 }else{
  const liquidWater=profile.waterFraction*smooth(250,285,profile.temperatureK)*smooth(611,3000,profile.pressurePa);
  const ocean=liquidWater*smooth(-.08,.1,continent+.08);
  const ironTint=metal*.18,desert=smooth(.22,.62,mineral+profile.temperatureK/1500);
  const silicateTone=profile.silicateFraction*.07;
  albedo=[.22+silicateTone+mineral*.11+ironTint,.22+silicateTone*.7+mineral*.09-ironTint*.3,.2+silicateTone*.4+mineral*.06-ironTint*.5];
  albedo=[albedo[0]*(1-desert*.22),albedo[1]*(1-desert*.35),albedo[2]*(1-desert*.45)];
  if(profile.class==='volcanic'||volcanic>.55){albedo=[.12+volcanic*.22,.075+volcanic*.045,.045+volcanic*.02];material='lava';roughness=.55;}
  if(ocean>.35){albedo=[.012,.055,.12];material='water';roughness=.08;}
  if(effectiveIce>0.05&&polar>0.1){albedo=[.72,.79,.83];material='ice';roughness=.28;}
  if(desert>.62&&material==='rock'){material='sand';roughness=.96;}
 }
 return {height,albedo,roughness,material};
}
export interface SurfaceCubeMaps{resolution:number;seed:number;albedo:Uint8Array;heightRoughness:Uint8Array;normal:Uint8Array;}
export function surfaceResolutionForProjectedRadius(projectedRadius:number):number{
 if(!Number.isFinite(projectedRadius)||projectedRadius<0)throw new RangeError('Projected radius must be finite and non-negative.');
 return projectedRadius>420?512:projectedRadius>70?256:projectedRadius>18?128:64;
}
const FACE_DIRECTIONS=[
 (u:number,v:number):[number,number,number]=>[1,-v,-u],
 (u:number,v:number):[number,number,number]=>[-1,-v,u],
 (u:number,v:number):[number,number,number]=>[u,1,v],
 (u:number,v:number):[number,number,number]=>[u,-1,-v],
 (u:number,v:number):[number,number,number]=>[u,-v,1],
 (u:number,v:number):[number,number,number]=>[-u,-v,-1]
];
export async function generateSurfaceCubeMaps(profile:SurfaceGenerationProfile,resolution=128,yieldFace?:()=>Promise<void>):Promise<SurfaceCubeMaps>{
 if(!Number.isInteger(resolution)||resolution<8||resolution>1024)throw new RangeError('Surface map resolution must be an integer from 8 to 1024.');
 const pixels=6*resolution*resolution,albedo=new Uint8Array(pixels*4),heightRoughness=new Uint8Array(pixels*4),normal=new Uint8Array(pixels*4);
 const index=(face:number,x:number,y:number)=>(face*resolution*resolution+y*resolution+x)*4;
 const eps=1/resolution;
 for(let face=0;face<6;face++){
  for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
   const u=(x/(resolution-1))*2-1,v=(y/(resolution-1))*2-1,dir=FACE_DIRECTIONS[face](u,v);
   const sample=sampleSurface(dir,profile),i=index(face,x,y);
   albedo[i]=Math.round(clamp(sample.albedo[0])*255);albedo[i+1]=Math.round(clamp(sample.albedo[1])*255);albedo[i+2]=Math.round(clamp(sample.albedo[2])*255);albedo[i+3]=255;
   heightRoughness[i]=Math.round(clamp(sample.height*.5+.5)*255);heightRoughness[i+1]=Math.round(sample.roughness*255);heightRoughness[i+2]=0;heightRoughness[i+3]=255;
   const length=Math.hypot(...dir),unit=dir.map(value=>value/length) as [number,number,number];
   const reference: [number,number,number]=Math.abs(unit[1])<.9?[0,1,0]:[1,0,0];
   const tangent=[unit[1]*reference[2]-unit[2]*reference[1],unit[2]*reference[0]-unit[0]*reference[2],unit[0]*reference[1]-unit[1]*reference[0]];
   const tangentLength=Math.hypot(...tangent),t1=tangent.map(value=>value/tangentLength),t2=[unit[1]*t1[2]-unit[2]*t1[1],unit[2]*t1[0]-unit[0]*t1[2],unit[0]*t1[1]-unit[1]*t1[0]];
   const offset=(axis:number[],sign:number)=>{const d=unit.map((value,k)=>value+axis[k]*eps*sign),m=Math.hypot(...d);return d.map(value=>value/m) as [number,number,number];};
   const du=(sampleSurfaceHeight(offset(t1,1),profile)-sampleSurfaceHeight(offset(t1,-1),profile))/(2*eps);
   const dv=(sampleSurfaceHeight(offset(t2,1),profile)-sampleSurfaceHeight(offset(t2,-1),profile))/(2*eps);
   const nn=unit.map((value,k)=>value-t1[k]*du*.08-t2[k]*dv*.08),normalLength=Math.hypot(...nn),nx=nn[0]/normalLength,ny=nn[1]/normalLength,nz=nn[2]/normalLength;
   normal[i]=Math.round((nx*.5+.5)*255);normal[i+1]=Math.round((ny*.5+.5)*255);normal[i+2]=Math.round((nz*.5+.5)*255);normal[i+3]=255;
  }
  if(yieldFace)await yieldFace();
 }
 return {resolution,seed:profile.seed,albedo,heightRoughness,normal};
}
