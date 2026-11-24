import type { CelestialBody } from '../../physics/celestial-body.ts';
import type { PlanetarySurfaceClass } from '../../types/physics.ts';
import type { SurfaceProfile, SurfaceKind } from './surface-tile.ts';

type BodyLike=Pick<CelestialBody,'id'|'massKg'|'meanRadiusM'|'surfaceSeed'|'surface'|'rotationPeriodSeconds'>;
const G=6.67430e-11;
const KNOWN:Record<string,Partial<SurfaceProfile>>={
 mercury:{kind:'rocky',temperatureK:440,pressurePa:0,waterFraction:0,iceFraction:.01,ironFraction:.68,silicateFraction:.29,volatileFraction:.005,sulfurFraction:.01,tectonicActivity:.01,volcanicActivity:.01,erosion:0,age:.85},
 venus:{kind:'volcanic',temperatureK:737,pressurePa:9.2e6,waterFraction:0,iceFraction:0,ironFraction:.3,silicateFraction:.68,volatileFraction:.02,sulfurFraction:.08,tectonicActivity:.24,volcanicActivity:.52,erosion:.3,age:.36},
 earth:{kind:'oceanic',temperatureK:288,pressurePa:101325,waterFraction:.71,iceFraction:.025,ironFraction:.32,silicateFraction:.62,volatileFraction:.03,sulfurFraction:.01,tectonicActivity:.8,volcanicActivity:.32,erosion:.78,age:.18},
 mars:{kind:'desert',temperatureK:210,pressurePa:610,waterFraction:.015,iceFraction:.12,ironFraction:.28,silicateFraction:.67,volatileFraction:.04,sulfurFraction:.02,tectonicActivity:.08,volcanicActivity:.12,erosion:.14,age:.65},
 moon:{kind:'rocky',temperatureK:220,pressurePa:0,waterFraction:.001,iceFraction:.025,ironFraction:.12,silicateFraction:.82,volatileFraction:.005,sulfurFraction:.002,tectonicActivity:.01,volcanicActivity:.02,erosion:0,age:.92},
 phobos:{kind:'rocky',temperatureK:233,pressurePa:0,waterFraction:.001,iceFraction:.03,ironFraction:.2,silicateFraction:.65,volatileFraction:.02,sulfurFraction:.01,tectonicActivity:.01,volcanicActivity:0,erosion:0,age:.95},
 deimos:{kind:'rocky',temperatureK:233,pressurePa:0,waterFraction:.001,iceFraction:.03,ironFraction:.18,silicateFraction:.68,volatileFraction:.02,sulfurFraction:.01,tectonicActivity:0,volcanicActivity:0,erosion:0,age:.96},
 io:{kind:'volcanic',temperatureK:130,pressurePa:0,waterFraction:0,iceFraction:0,ironFraction:.25,silicateFraction:.55,volatileFraction:.08,sulfurFraction:.42,tectonicActivity:.25,volcanicActivity:1,erosion:.02,age:.05},
 europa:{kind:'icy',temperatureK:102,pressurePa:0,waterFraction:.35,iceFraction:.8,ironFraction:.15,silicateFraction:.15,volatileFraction:.12,sulfurFraction:.02,tectonicActivity:.18,volcanicActivity:.02,erosion:.08,age:.3},
 ganymede:{kind:'icy',temperatureK:110,pressurePa:0,waterFraction:.35,iceFraction:.55,ironFraction:.22,silicateFraction:.35,volatileFraction:.12,sulfurFraction:.02,tectonicActivity:.12,volcanicActivity:.01,erosion:.08,age:.55},
 callisto:{kind:'icy',temperatureK:134,pressurePa:0,waterFraction:.45,iceFraction:.5,ironFraction:.18,silicateFraction:.38,volatileFraction:.1,sulfurFraction:.02,tectonicActivity:.02,volcanicActivity:0,erosion:.02,age:.94},
 titan:{kind:'desert',temperatureK:94,pressurePa:146000,waterFraction:.02,iceFraction:.7,ironFraction:.08,silicateFraction:.2,volatileFraction:.2,sulfurFraction:.005,tectonicActivity:.12,volcanicActivity:.04,erosion:.55,age:.42},
 triton:{kind:'icy',temperatureK:38,pressurePa:1.4,waterFraction:.15,iceFraction:.9,ironFraction:.08,silicateFraction:.12,volatileFraction:.55,sulfurFraction:.02,tectonicActivity:.12,volcanicActivity:.15,erosion:.18,age:.4},
 jupiter:{kind:'gas-giant',temperatureK:165,pressurePa:1e5,waterFraction:.08,iceFraction:0,ironFraction:0,silicateFraction:0,volatileFraction:.42,sulfurFraction:.02,tectonicActivity:0,volcanicActivity:0,erosion:.4,age:.1},
 saturn:{kind:'gas-giant',temperatureK:134,pressurePa:1e5,waterFraction:.05,iceFraction:0,ironFraction:0,silicateFraction:0,volatileFraction:.38,sulfurFraction:.01,tectonicActivity:0,volcanicActivity:0,erosion:.4,age:.1},
 uranus:{kind:'ice-giant',temperatureK:76,pressurePa:1e5,waterFraction:.35,iceFraction:.5,ironFraction:0,silicateFraction:0,volatileFraction:.62,sulfurFraction:.005,tectonicActivity:0,volcanicActivity:0,erosion:.35,age:.1},
 neptune:{kind:'ice-giant',temperatureK:72,pressurePa:1e5,waterFraction:.35,iceFraction:.5,ironFraction:0,silicateFraction:0,volatileFraction:.64,sulfurFraction:.008,tectonicActivity:0,volcanicActivity:0,erosion:.35,age:.1}
};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function stableSeed(id:string):number{let h=2166136261;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function classify(id:string,mass:number,radius:number,temp:number,pressure:number,water:number,ice:number):SurfaceKind{
 const known=KNOWN[id]?.kind;if(known)return known;
 const density=mass/(4*Math.PI*radius*radius*radius/3),earthR=radius/6_371_000;
 if(earthR>5.5&&density<2200)return'gas-giant';
 if(earthR>2.4&&density<2600)return'ice-giant';
 if(pressure>1e6&&temp>450)return'volcanic';
 if(ice>.35||temp<150)return'icy';
 if(water>.45&&pressure>600)return'oceanic';
 if(temp>300&&water<.1)return'desert';
 return'rocky';
}
export function createGeologicalProfile(body:BodyLike):SurfaceProfile{
 const known=KNOWN[body.id.toLowerCase()]??{},source=body.surface??{},seed=body.surfaceSeed??stableSeed(body.id);
 const temperatureK=source.temperatureK??known.temperatureK??260,pressurePa=source.pressurePa??known.pressurePa??0;
 const waterFraction=source.waterFraction??known.waterFraction??.08,iceFraction=source.iceFraction??known.iceFraction??.08;
 const kind=(source.class?mapClass(source.class):known.kind??classify(body.id,body.massKg,body.meanRadiusM,temperatureK,pressurePa,waterFraction,iceFraction));
 const profile:SurfaceProfile={
  bodyId:body.id,seed,kind,massKg:body.massKg,meanRadiusM:body.meanRadiusM,
  gravityMS2:G*body.massKg/(body.meanRadiusM*body.meanRadiusM),temperatureK,pressurePa,
  waterFraction:clamp(waterFraction),iceFraction:clamp(iceFraction),
  ironFraction:clamp(source.ironFraction??known.ironFraction??.25),
  silicateFraction:clamp(source.silicateFraction??known.silicateFraction??.58),
  volatileFraction:clamp(source.volatileFraction??known.volatileFraction??.04),
  sulfurFraction:clamp(source.sulfurFraction??known.sulfurFraction??.01),
  tectonicActivity:clamp(source.tectonicActivity??known.tectonicActivity??.2),
  volcanicActivity:clamp(source.volcanicActivity??known.volcanicActivity??.1),
  erosion:clamp(source.erosion??known.erosion??.25),age:clamp(source.impactAge??known.age??.5),
  rotationPeriodSeconds:body.rotationPeriodSeconds??null,algorithmVersion:1
 };
 return Object.freeze(profile);
}
function mapClass(value:PlanetarySurfaceClass):SurfaceKind{
 if(value==='gas-giant')return'gas-giant';if(value==='ice-giant')return'ice-giant';
 if(value==='oceanic')return'oceanic';if(value==='desert'||value==='dense-atmosphere')return'desert';
 if(value==='icy'||value==='icy-moon')return'icy';if(value==='volcanic'||value==='volcanic-moon')return'volcanic';
 return'rocky';
}
export function surfaceSeedForId(id:string):number{return stableSeed(id);}
