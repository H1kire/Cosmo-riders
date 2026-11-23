import { stableSeed, fbm3, ridged3, worley3, domainWarp3 } from './noise.ts';

export type SurfaceClass =
 | 'rocky' | 'oceanic' | 'desert' | 'icy' | 'volcanic' | 'dense-atmosphere'
 | 'gas-giant' | 'ice-giant' | 'airless-moon' | 'icy-moon' | 'volcanic-moon';
export type SurfaceMaterial = 'silicate-rock' | 'iron-oxide' | 'metal-rich-rock' | 'basalt' | 'sand' | 'water' | 'water-ice' | 'volatile-ice' | 'sulfur' | 'hydrocarbon' | 'cloud' | 'lava';
export interface SurfaceGenerationProfile {
 id:string; seed:number; class:SurfaceClass; gravityMS2:number; temperatureK:number; pressurePa:number;
 waterFraction:number; iceFraction:number; ironFraction:number; silicateFraction:number; metalFraction:number;
 volatileFraction:number; hydrocarbonFraction:number; sulfurFraction:number;
 tectonicActivity:number; volcanicActivity:number; impactAge:number; erosion:number; rotationFactor:number;
 mineralComposition:readonly string[];
}
export interface SurfaceSample { height:number; albedo:[number,number,number]; roughness:number; material:SurfaceMaterial; }
export interface SurfaceBodyInput {
 id:string; massKg:number; meanRadiusM:number; surfaceSeed?:number|null;
 surface?:Partial<Omit<SurfaceGenerationProfile,'id'|'seed'|'gravityMS2'>> & {mineralComposition?:readonly string[]};
}
export interface SurfaceCubeMaps {
 resolution:number; seed:number; albedo:Uint8Array; height:Uint8Array; roughness:Uint8Array; normal:Uint8Array;
}
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
const KNOWN:Record<string,Partial<SurfaceGenerationProfile>>={
 earth:{class:'oceanic',temperatureK:288,pressurePa:101325,waterFraction:.71,iceFraction:.025,ironFraction:.32,silicateFraction:.62,metalFraction:.08,volatileFraction:.03,hydrocarbonFraction:0,sulfurFraction:.01,tectonicActivity:.8,volcanicActivity:.32,impactAge:.18,erosion:.78,rotationFactor:1,mineralComposition:['silicates','feldspar','quartz','iron-oxides','carbonates']},
 moon:{class:'airless-moon',temperatureK:220,pressurePa:0,waterFraction:.001,iceFraction:.025,ironFraction:.12,silicateFraction:.82,metalFraction:.04,volatileFraction:.005,hydrocarbonFraction:0,sulfurFraction:.002,tectonicActivity:.01,volcanicActivity:.02,impactAge:.92,erosion:0,rotationFactor:.07,mineralComposition:['plagioclase','pyroxene','olivine','ilmenite']},
 mars:{class:'desert',temperatureK:210,pressurePa:610,waterFraction:.015,iceFraction:.12,ironFraction:.28,silicateFraction:.67,metalFraction:.03,volatileFraction:.04,hydrocarbonFraction:0,sulfurFraction:.02,tectonicActivity:.08,volcanicActivity:.12,impactAge:.65,erosion:.14,rotationFactor:.24,mineralComposition:['basalt','hematite','magnetite','sulfates','perchlorates']},
 mercury:{class:'airless-moon',temperatureK:440,pressurePa:0,waterFraction:0,iceFraction:.01,ironFraction:.68,silicateFraction:.29,metalFraction:.22,volatileFraction:.005,hydrocarbonFraction:0,sulfurFraction:.01,tectonicActivity:.01,volcanicActivity:.01,impactAge:.85,erosion:0,rotationFactor:.04,mineralComposition:['silicates','iron','sulfides','graphite']},
 venus:{class:'dense-atmosphere',temperatureK:737,pressurePa:9.2e6,waterFraction:0,iceFraction:0,ironFraction:.3,silicateFraction:.68,metalFraction:.04,volatileFraction:.02,hydrocarbonFraction:0,sulfurFraction:.08,tectonicActivity:.24,volcanicActivity:.52,impactAge:.36,erosion:.3,rotationFactor:.01,mineralComposition:['basalt','ultramafic-rock','sulfur-compounds']},
 io:{class:'volcanic-moon',temperatureK:130,pressurePa:0,waterFraction:0,iceFraction:.0,ironFraction:.25,silicateFraction:.55,metalFraction:.03,volatileFraction:.08,hydrocarbonFraction:0,sulfurFraction:.42,tectonicActivity:.25,volcanicActivity:1,impactAge:.05,erosion:.02,rotationFactor:.41,mineralComposition:['sulfur','sulfur-dioxide-frost','silicates','basalt']},
 europa:{class:'icy-moon',temperatureK:102,pressurePa:0,waterFraction:.35,iceFraction:.8,ironFraction:.15,silicateFraction:.15,metalFraction:.02,volatileFraction:.12,hydrocarbonFraction:0,sulfurFraction:.02,tectonicActivity:.18,volcanicActivity:.02,impactAge:.3,erosion:.08,rotationFactor:.23,mineralComposition:['water-ice','hydrated-salts','silicates']},
 titan:{class:'dense-atmosphere',temperatureK:94,pressurePa:146000,waterFraction:.02,iceFraction:.7,ironFraction:.08,silicateFraction:.2,metalFraction:.01,volatileFraction:.2,hydrocarbonFraction:.32,sulfurFraction:.005,tectonicActivity:.12,volcanicActivity:.04,impactAge:.42,erosion:.55,rotationFactor:.09,mineralComposition:['water-ice','ammonia-ice','organic-tholins','methane','ethane']},
 jupiter:{class:'gas-giant',temperatureK:165,pressurePa:1e5,waterFraction:.08,iceFraction:0,ironFraction:0,silicateFraction:0,metalFraction:0,volatileFraction:.42,hydrocarbonFraction:.08,sulfurFraction:.02,tectonicActivity:0,volcanicActivity:0,impactAge:.1,erosion:.4,rotationFactor:1,mineralComposition:['molecular-hydrogen','helium','ammonia','ammonium-hydrosulfide','water-clouds']},
 saturn:{class:'gas-giant',temperatureK:134,pressurePa:1e5,waterFraction:.05,iceFraction:0,ironFraction:0,silicateFraction:0,metalFraction:0,volatileFraction:.38,hydrocarbonFraction:.12,sulfurFraction:.01,tectonicActivity:0,volcanicActivity:0,impactAge:.1,erosion:.4,rotationFactor:.92,mineralComposition:['molecular-hydrogen','helium','ammonia','phosphine','hydrocarbons']},
 uranus:{class:'ice-giant',temperatureK:76,pressurePa:1e5,waterFraction:.35,iceFraction:.5,ironFraction:0,silicateFraction:0,metalFraction:0,volatileFraction:.62,hydrocarbonFraction:.16,sulfurFraction:.005,tectonicActivity:0,volcanicActivity:0,impactAge:.1,erosion:.35,rotationFactor:.7,mineralComposition:['hydrogen','helium','methane','water','ammonia','hydrogen-sulfide']},
 neptune:{class:'ice-giant',temperatureK:72,pressurePa:1e5,waterFraction:.35,iceFraction:.5,ironFraction:0,silicateFraction:0,metalFraction:0,volatileFraction:.64,hydrocarbonFraction:.18,sulfurFraction:.008,tectonicActivity:0,volcanicActivity:0,impactAge:.1,erosion:.35,rotationFactor:.85,mineralComposition:['hydrogen','helium','methane','water','ammonia','hydrogen-sulfide']}
};
export function createSurfaceProfile(body:SurfaceBodyInput):SurfaceGenerationProfile {
 const seed=body.surfaceSeed??stableSeed(body.id),gravity=6.67430e-11*body.massKg/(body.meanRadiusM*body.meanRadiusM);
 const fallback:Partial<SurfaceGenerationProfile>=gravity<2
  ?{class:'icy-moon',temperatureK:160,pressurePa:0,waterFraction:.18,iceFraction:.4,ironFraction:.18,silicateFraction:.38,metalFraction:.03,volatileFraction:.1,hydrocarbonFraction:0,sulfurFraction:.01,tectonicActivity:.12,volcanicActivity:.08,impactAge:.55,erosion:.15,rotationFactor:.3,mineralComposition:['water-ice','silicates']}
  :{class:'rocky',temperatureK:260,pressurePa:0,waterFraction:.08,iceFraction:.08,ironFraction:.28,silicateFraction:.58,metalFraction:.05,volatileFraction:.04,hydrocarbonFraction:0,sulfurFraction:.01,tectonicActivity:.25,volcanicActivity:.18,impactAge:.48,erosion:.3,rotationFactor:.5,mineralComposition:['silicates','iron-oxides']};
 const inferred=body.id.toLowerCase().includes('gas')?{class:'gas-giant' as const}:body.id.toLowerCase().includes('ice')?{class:'ice-giant' as const}:pressureGuess(body,gravity);
 const base={...fallback,...inferred,...KNOWN[body.id.toLowerCase()],...body.surface};
 const fraction=(v:number,d:number)=>clamp(v??d);
 return {id:body.id,seed,class:base.class??'rocky',gravityMS2:gravity,temperatureK:base.temperatureK??260,pressurePa:base.pressurePa??0,
  waterFraction:fraction(base.waterFraction,.08),iceFraction:fraction(base.iceFraction,.08),ironFraction:fraction(base.ironFraction,.28),silicateFraction:fraction(base.silicateFraction,.58),
  metalFraction:fraction(base.metalFraction,.05),volatileFraction:fraction(base.volatileFraction,.04),hydrocarbonFraction:fraction(base.hydrocarbonFraction,0),sulfurFraction:fraction(base.sulfurFraction,.01),
  tectonicActivity:fraction(base.tectonicActivity,.25),volcanicActivity:fraction(base.volcanicActivity,.18),impactAge:fraction(base.impactAge,.48),erosion:fraction(base.erosion,.3),rotationFactor:fraction(base.rotationFactor,.5),
  mineralComposition:base.mineralComposition??['silicates','iron-oxides']};
}
function pressureGuess(body:SurfaceBodyInput,gravity:number):Partial<SurfaceGenerationProfile>{
 if(body.surface?.class)return {};
 const pressure=body.surface?.pressurePa??0,temp=body.surface?.temperatureK??(gravity<2?150:260);
 if(pressure>1e6)return {class:'dense-atmosphere'};
 if(temp<125&&gravity<3)return {class:'icy-moon'};
 return {};
}
function atmosphereSample(x:number,y:number,z:number,p:SurfaceGenerationProfile):SurfaceSample{
 const lat=y,seed=p.seed;
 const flow=domainWarp3(x*3.2,y*18,z*3.2,seed,.32);
 const broad=fbm3(flow[0]*2,flow[1],flow[2]*2,seed+211,6);
 const cloud=fbm3(x*14,y*36,z*14,seed+307,5);
 const turbulence=ridged3(x*11,y*22,z*11,seed+401,5);
 const rotation=p.rotationFactor;
 const bandWave=Math.sin((y* (p.class==='ice-giant'?34:58+rotation*28) + broad*.09)*Math.PI*2);
 const belt=smooth(-.28,.38,bandWave+ (broad-.5)*.5);
 const jet=fbm3(x*22,y*8,z*22,seed+503,4);
 const vortexField=worley3(x*5+jet*1.3,y*3,z*5,seed+601);
 const vortex=1-smooth(.12,.42,vortexField);
 const storm=smooth(.68,.94,cloud+turbulence*.22)*vortex;
 let base:[number,number,number];
 if(p.id==='jupiter') {
  const dark:[number,number,number]=[.28,.13,.075],light:[number,number,number]=[.78,.56,.34];
  base=dark.map((v,i)=>v+(light[i]-v)*belt) as [number,number,number];
  base=[base[0]+storm*.38,base[1]+storm*.12,base[2]+storm*.035];
 } else if(p.id==='saturn') {
  const dark:[number,number,number]=[.43,.34,.22],light:[number,number,number]=[.82,.72,.52];
  base=dark.map((v,i)=>v+(light[i]-v)*belt) as [number,number,number];
  base=[base[0]+storm*.12,base[1]+storm*.09,base[2]+storm*.045];
 } else if(p.id==='uranus') {
  base=[.18+belt*.12+cloud*.045,.43+belt*.16+cloud*.07,.58+belt*.16+cloud*.08];
  base=[base[0]+storm*.18,base[1]+storm*.2,base[2]+storm*.2];
 } else if(p.id==='neptune') {
  base=[.035+belt*.08+cloud*.04,.12+belt*.2+cloud*.08,.36+belt*.32+cloud*.1];
  base=[base[0]+storm*.28,base[1]+storm*.26,base[2]+storm*.22];
 } else if(p.class==='ice-giant') {
  const methaneHaze=clamp(p.hydrocarbonFraction*.8+p.volatileFraction*.12);
  base=[.12+belt*.12+cloud*.07,.36+belt*.22+cloud*.09,.52+belt*.22+cloud*.1];
  base=[base[0]*(1-methaneHaze*.16)+storm*.12,base[1]*(1-methaneHaze*.08)+storm*.16,base[2]+storm*.18];
 } else {
  const methane=p.hydrocarbonFraction;
  base=[.25+belt*.32+cloud*.18,.2+belt*.24+cloud*.13,.12+belt*.12+cloud*.08];
  base=[base[0]*(1-methane*.25),base[1]*(1-methane*.2),base[2]*(1-methane*.1)];
 }
 const polar=smooth(.72,.98,Math.abs(lat));
 const haze=clamp(p.volatileFraction*.25+p.pressurePa/1e7*.15);
 base=base.map((v,i)=>v*(1-haze*.12)+polar*(i===0?.12:.16)) as [number,number,number];
 return {height:0,albedo:base,roughness:clamp(.72-cloud*.18,.35,.9),material:'cloud'};
}
export function sampleSurfaceHeight(direction:[number,number,number],profile:SurfaceGenerationProfile):number {
 const [x,y,z]=normalize(direction);
 if(profile.class==='gas-giant'||profile.class==='ice-giant')return 0;
 const seed=profile.seed;
 const broad=fbm3(x*3.2,y*3.2,z*3.2,seed,5),regional=fbm3(x*13,y*13,z*13,seed+17,4);
 const ridges=ridged3(x*21,y*21,z*21,seed+31,4);
 const tectonic=ridged3(x*5+regional,y*5,z*5,seed+89,4)*profile.tectonicActivity;
 const volcanic=fbm3(x*11,y*11,z*11,seed+103,4)*profile.volcanicActivity;
 const crater=profile.impactAge*(1-smooth(.22,.58,worley3(x*9,y*9,z*9,seed+71)))*.12;
 const weathering=clamp(profile.erosion+Math.log10(1+profile.pressurePa)/8*.12);
 const gravityScale=clamp(1.25/Math.sqrt(Math.max(.1,profile.gravityMS2)),.55,1.8);
 return (broad*.2+regional*.1+ ridges*.1+tectonic*.14+volcanic*.1-crater)* (1-weathering*.42)*gravityScale;
}
function normalize(d:[number,number,number]):[number,number,number]{const m=Math.hypot(d[0],d[1],d[2])||1;return[d[0]/m,d[1]/m,d[2]/m];}
export function sampleSurface(direction:[number,number,number],profile:SurfaceGenerationProfile):SurfaceSample {
 const [x,y,z]=normalize(direction),seed=profile.seed;
 if(profile.class==='gas-giant'||profile.class==='ice-giant')return atmosphereSample(x,y,z,profile);
 const broad=fbm3(x*3.2,y*3.2,z*3.2,seed,5),regional=fbm3(x*13,y*13,z*13,seed+17,4);
 const mineral=fbm3(x*32,y*32,z*32,seed+131,4),fine=fbm3(x*72,y*72,z*72,seed+157,3);
 const cells=worley3(x*68,y*68,z*68,seed+47),craters=worley3(x*9,y*9,z*9,seed+71);
 const tectonic=ridged3(x*5+regional,y*5,z*5,seed+89,4)*profile.tectonicActivity;
 const lava=fbm3(x*11,y*11,z*11,seed+103,4)*profile.volcanicActivity;
 const latitude=Math.abs(y),polar=smooth(.78,.98,latitude),cold=smooth(300,145,profile.temperatureK);
 const liquidAllowed=profile.temperatureK>=273.15&&profile.temperatureK<=373.15&&profile.pressurePa>=611;
 const methaneLiquid=profile.temperatureK>=90&&profile.temperatureK<=95&&profile.pressurePa>=1e5;
 const liquid=liquidAllowed?profile.waterFraction:0;
 const ice=clamp(Math.max(profile.iceFraction,cold*profile.volatileFraction));
 const iron=profile.ironFraction,metal=profile.metalFraction,silicate=profile.silicateFraction;
 const craterRim=smooth(.18,.28,craters)*(1-smooth(.32,.5,craters))*profile.impactAge;
 let albedo:[number,number,number]=[.3,.28,.24],roughness=.88,material:SurfaceMaterial='silicate-rock';
 let height=sampleSurfaceHeight([x,y,z],profile);
 if(profile.class==='icy'||profile.class==='icy-moon'||ice>.62){
  const crack=smooth(.72,.91,cells)*(1-profile.erosion*.55);
  const salt=profile.volatileFraction*.12;
  albedo=[.52+polar*.25+salt-crack*.16,.67+polar*.22+salt-crack*.13,.76+polar*.18+salt-crack*.09];
  roughness=.3+profile.erosion*.25;material='water-ice';height+=crack*.018;
 }else if(profile.class==='volcanic'||profile.class==='volcanic-moon'){
  const sulfur=profile.sulfurFraction;
  const sulfurField=fbm3(x*19,y*19,z*19,seed+311,4);
  const sulfurPatch=smooth(.35,.72,sulfurField)*sulfur;
  albedo=[.055+lava*.2+sulfurPatch*.55,.035+lava*.09+sulfurPatch*.34,.025+lava*.035+sulfurPatch*.08];
  material=sulfur>.18?'sulfur':'lava';roughness=.58; height+=lava*.04;
 }else if(profile.class==='desert'){
  const ironOxide=clamp(iron*.75+mineral*.3);
  const dune=fbm3(x*8+regional,y*8,z*8,seed+271,5);
  albedo=[.24+ironOxide*.34+dune*.16,.105+ironOxide*.12+dune*.1,.045+ironOxide*.06+dune*.07];
  material='iron-oxide';roughness=.91;height+=ridged3(x*17,y*17,z*17,seed+281,4)*.025;
 }else if(profile.class==='dense-atmosphere'){
  if(profile.hydrocarbonFraction>.08){
   const drainage=fbm3(x*15,y*15,z*15,seed+331,5),lake=methaneLiquid?smooth(.54,.68,drainage):0;
   albedo=[.24+drainage*.24,.16+drainage*.17,.07+drainage*.09];
   if(lake>.15){albedo=[.045,.035,.018];material='hydrocarbon';roughness=.12;}
   else {material='water-ice';roughness=.72;}
   height+=ridged3(x*18,y*18,z*18,seed+341,4)*.018;
  }else{
   const volcanicField=fbm3(x*12,y*12,z*12,seed+351,4);
   albedo=[.2+mineral*.16+volcanicField*.08,.16+mineral*.1,.12+mineral*.07];
   material='basalt';roughness=.86;height+=tectonic*.035;
  }
 }else{
  const ironOxide=iron*.38+metal*.18+mineral*.22;
  const silicateTone=silicate*.22;
  albedo=[.19+silicateTone+ironOxide*.28+fine*.09,.18+silicateTone*.72+ironOxide*.12+fine*.07,.16+silicateTone*.48+fine*.05];
  albedo=[albedo[0]*(1-profile.erosion*.08),albedo[1]*(1-profile.erosion*.08),albedo[2]*(1-profile.erosion*.08)];
  if(liquid>.08&&broad<.48){albedo=[.012,.055,.12];material='water';roughness=.08;}
  if(ice>.08&&polar>.12){albedo=[.72,.81,.88];material='water-ice';roughness=.28;}
  if(lava>.58){albedo=[.12+lava*.22,.065+lava*.06,.035+lava*.025];material='lava';roughness=.55;}
  if(profile.class==='airless-moon'||profile.impactAge>.72){albedo=albedo.map(v=>v*(.76+craterRim*.3)) as [number,number,number];height-=craterRim*.06;}
  if(profile.class==='rocky'&&profile.pressurePa>1e4){const weather=profile.erosion*.12;albedo=albedo.map(v=>v*(1-weather)) as [number,number,number];}
 }
 const mineralContrast=clamp(profile.mineralComposition.length/8,.15,1);
 albedo=albedo.map(v=>clamp(v*(.92+mineralContrast*.12))) as [number,number,number];
 height=clamp(height,-.45,.45);
 return {height,albedo,roughness,material};
}
export function surfaceProfileKey(profile:SurfaceGenerationProfile):string{return stableSeed(JSON.stringify(profile)).toString(16)+':'+profile.seed;}
export function surfaceResolutionForProjectedRadius(projectedRadius:number):number {
 if(!Number.isFinite(projectedRadius)||projectedRadius<0)throw new RangeError('Projected radius must be finite and non-negative.');
 return projectedRadius>520?512:projectedRadius>150?256:projectedRadius>35?128:64;
}
const FACE_DIRECTIONS=[
 (u:number,v:number):[number,number,number]=>[1,-v,-u],(u:number,v:number):[number,number,number]=>[-1,-v,u],
 (u:number,v:number):[number,number,number]=>[u,1,v],(u:number,v:number):[number,number,number]=>[u,-1,-v],
 (u:number,v:number):[number,number,number]=>[u,-v,1],(u:number,v:number):[number,number,number]=>[-u,-v,-1]
];
export function cubeFaceDirection(face:number,u:number,v:number):[number,number,number]{
 if(!Number.isInteger(face)||face<0||face>=6)throw new RangeError('Cube face index must be in [0, 5].');
 return normalize(FACE_DIRECTIONS[face](u,v));
}
export async function generateSurfaceCubeMaps(profile:SurfaceGenerationProfile,resolution=128,yieldFace?:()=>Promise<void>):Promise<SurfaceCubeMaps>{
 if(!Number.isInteger(resolution)||resolution<8||resolution>1024)throw new RangeError('Surface map resolution must be an integer from 8 to 1024.');
 const pixels=6*resolution*resolution,albedo=new Uint8Array(pixels*4),height=new Uint8Array(pixels*4),roughness=new Uint8Array(pixels*4),normal=new Uint8Array(pixels*4);
 const idx=(face:number,x:number,y:number)=>(face*resolution*resolution+y*resolution+x)*4;
 const eps=1/resolution,gas=profile.class==='gas-giant'||profile.class==='ice-giant';
 for(let face=0;face<6;face++){
  for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++){
   const u=x/(resolution-1)*2-1,v=y/(resolution-1)*2-1,dir=cubeFaceDirection(face,u,v),sample=sampleSurface(dir,profile),i=idx(face,x,y);
   albedo[i]=Math.round(clamp(sample.albedo[0])*255);albedo[i+1]=Math.round(clamp(sample.albedo[1])*255);albedo[i+2]=Math.round(clamp(sample.albedo[2])*255);albedo[i+3]=255;
   height[i]=Math.round(clamp(sample.height+.5)*255);height[i+1]=0;height[i+2]=0;height[i+3]=255;
   roughness[i]=Math.round(clamp(sample.roughness)*255);roughness[i+1]=0;roughness[i+2]=0;roughness[i+3]=255;
   if(gas){normal[i]=128;normal[i+1]=128;normal[i+2]=255;normal[i+3]=255;continue;}
   const up: [number,number,number]=Math.abs(dir[1])<.9?[0,1,0]:[1,0,0];
   const cross=(a:number[],b:number)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
   const t=normalize(cross(dir,up)),b=cross(dir,t);
   const offset=(axis:number[],sign:number)=>normalize([dir[0]+axis[0]*eps*sign,dir[1]+axis[1]*eps*sign,dir[2]+axis[2]*eps*sign]);
   const du=(sampleSurfaceHeight(offset(t,1),profile)-sampleSurfaceHeight(offset(t,-1),profile))/(2*eps);
   const dv=(sampleSurfaceHeight(offset(b,1),profile)-sampleSurfaceHeight(offset(b,-1),profile))/(2*eps);
   const n=normalize([dir[0]-t[0]*du*.045-b[0]*dv*.045,dir[1]-t[1]*du*.045-b[1]*dv*.045,dir[2]-t[2]*du*.045-b[2]*dv*.045]);
   normal[i]=Math.round((n[0]*.5+.5)*255);normal[i+1]=Math.round((n[1]*.5+.5)*255);normal[i+2]=Math.round((n[2]*.5+.5)*255);normal[i+3]=255;
  }
  if(yieldFace)await yieldFace();
 }
 return {resolution,seed:profile.seed,albedo,height,roughness,normal};
}
