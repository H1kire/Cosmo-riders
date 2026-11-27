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
 // Для малих нерегулярних супутників нижче задані консервативні візуальні профілі, а не виміряні глобальні склади.
 amalthea:{kind:'icy',temperatureK:120,pressurePa:0,waterFraction:.24,iceFraction:.42,ironFraction:.1,silicateFraction:.46,volatileFraction:.1,sulfurFraction:.06,tectonicActivity:.01,volcanicActivity:.01,erosion:.01,age:.9},
 thebe:{kind:'rocky',temperatureK:120,pressurePa:0,waterFraction:.01,iceFraction:.04,ironFraction:.16,silicateFraction:.68,volatileFraction:.03,sulfurFraction:.04,tectonicActivity:.01,volcanicActivity:0,erosion:.01,age:.94},
 adrastea:{kind:'rocky',temperatureK:110,pressurePa:0,waterFraction:0,iceFraction:.02,ironFraction:.2,silicateFraction:.7,volatileFraction:.01,sulfurFraction:.02,tectonicActivity:0,volcanicActivity:0,erosion:0,age:.96},
 metis:{kind:'rocky',temperatureK:110,pressurePa:0,waterFraction:0,iceFraction:.02,ironFraction:.22,silicateFraction:.68,volatileFraction:.01,sulfurFraction:.02,tectonicActivity:0,volcanicActivity:0,erosion:0,age:.96},
 himalia:{kind:'rocky',temperatureK:105,pressurePa:0,waterFraction:.02,iceFraction:.12,ironFraction:.12,silicateFraction:.48,volatileFraction:.12,sulfurFraction:.02,tectonicActivity:.01,volcanicActivity:0,erosion:.01,age:.92},
 mimas:{kind:'icy',temperatureK:64,pressurePa:0,waterFraction:.72,iceFraction:.92,ironFraction:.04,silicateFraction:.16,volatileFraction:.08,sulfurFraction:.005,tectonicActivity:.01,volcanicActivity:0,erosion:.01,age:.98},
 enceladus:{kind:'icy',temperatureK:75,pressurePa:0,waterFraction:.9,iceFraction:.96,ironFraction:.03,silicateFraction:.08,volatileFraction:.12,sulfurFraction:.005,tectonicActivity:.45,volcanicActivity:.25,erosion:.42,age:.18},
 tethys:{kind:'icy',temperatureK:86,pressurePa:0,waterFraction:.78,iceFraction:.94,ironFraction:.03,silicateFraction:.12,volatileFraction:.06,sulfurFraction:.003,tectonicActivity:.03,volcanicActivity:0,erosion:.02,age:.94},
 dione:{kind:'icy',temperatureK:87,pressurePa:0,waterFraction:.68,iceFraction:.86,ironFraction:.06,silicateFraction:.22,volatileFraction:.06,sulfurFraction:.004,tectonicActivity:.12,volcanicActivity:.01,erosion:.08,age:.58},
 rhea:{kind:'icy',temperatureK:76,pressurePa:0,waterFraction:.7,iceFraction:.88,ironFraction:.05,silicateFraction:.2,volatileFraction:.05,sulfurFraction:.003,tectonicActivity:.02,volcanicActivity:0,erosion:.02,age:.88},
 hyperion:{kind:'icy',temperatureK:92,pressurePa:0,waterFraction:.48,iceFraction:.7,ironFraction:.08,silicateFraction:.28,volatileFraction:.12,sulfurFraction:.01,tectonicActivity:.01,volcanicActivity:0,erosion:.01,age:.86},
 iapetus:{kind:'icy',temperatureK:110,pressurePa:0,waterFraction:.62,iceFraction:.82,ironFraction:.07,silicateFraction:.22,volatileFraction:.08,sulfurFraction:.008,tectonicActivity:.02,volcanicActivity:0,erosion:.03,age:.88},
 phoebe:{kind:'icy',temperatureK:75,pressurePa:0,waterFraction:.34,iceFraction:.58,ironFraction:.1,silicateFraction:.32,volatileFraction:.16,sulfurFraction:.02,tectonicActivity:.01,volcanicActivity:0,erosion:.01,age:.94},
 janus:{kind:'icy',temperatureK:134,pressurePa:0,waterFraction:.58,iceFraction:.78,ironFraction:.06,silicateFraction:.24,volatileFraction:.06,sulfurFraction:.004,tectonicActivity:.01,volcanicActivity:0,erosion:.02,age:.88},
 epimetheus:{kind:'icy',temperatureK:134,pressurePa:0,waterFraction:.58,iceFraction:.78,ironFraction:.06,silicateFraction:.24,volatileFraction:.06,sulfurFraction:.004,tectonicActivity:.01,volcanicActivity:0,erosion:.02,age:.88},
 helene:{kind:'icy',temperatureK:80,pressurePa:0,waterFraction:.76,iceFraction:.94,ironFraction:.03,silicateFraction:.12,volatileFraction:.06,sulfurFraction:.003,tectonicActivity:.01,volcanicActivity:0,erosion:.01,age:.9},
 atlas:{kind:'icy',temperatureK:80,pressurePa:0,waterFraction:.7,iceFraction:.9,ironFraction:.04,silicateFraction:.16,volatileFraction:.07,sulfurFraction:.004,tectonicActivity:.01,volcanicActivity:0,erosion:.02,age:.9},
 prometheus:{kind:'icy',temperatureK:80,pressurePa:0,waterFraction:.68,iceFraction:.88,ironFraction:.05,silicateFraction:.18,volatileFraction:.08,sulfurFraction:.004,tectonicActivity:.02,volcanicActivity:0,erosion:.03,age:.82},
 pandora:{kind:'icy',temperatureK:80,pressurePa:0,waterFraction:.68,iceFraction:.88,ironFraction:.05,silicateFraction:.18,volatileFraction:.08,sulfurFraction:.004,tectonicActivity:.02,volcanicActivity:0,erosion:.03,age:.82},
 pan:{kind:'icy',temperatureK:80,pressurePa:0,waterFraction:.66,iceFraction:.86,ironFraction:.06,silicateFraction:.2,volatileFraction:.08,sulfurFraction:.004,tectonicActivity:.02,volcanicActivity:0,erosion:.04,age:.8},
 miranda:{kind:'icy',temperatureK:64,pressurePa:0,waterFraction:.72,iceFraction:.9,ironFraction:.06,silicateFraction:.2,volatileFraction:.08,sulfurFraction:.005,tectonicActivity:.38,volcanicActivity:.02,erosion:.12,age:.34},
 ariel:{kind:'icy',temperatureK:64,pressurePa:0,waterFraction:.78,iceFraction:.94,ironFraction:.04,silicateFraction:.14,volatileFraction:.08,sulfurFraction:.004,tectonicActivity:.22,volcanicActivity:.01,erosion:.1,age:.38},
 umbriel:{kind:'icy',temperatureK:64,pressurePa:0,waterFraction:.76,iceFraction:.92,ironFraction:.05,silicateFraction:.16,volatileFraction:.06,sulfurFraction:.004,tectonicActivity:.04,volcanicActivity:0,erosion:.02,age:.9},
 titania:{kind:'icy',temperatureK:70,pressurePa:0,waterFraction:.7,iceFraction:.88,ironFraction:.07,silicateFraction:.22,volatileFraction:.07,sulfurFraction:.005,tectonicActivity:.12,volcanicActivity:.01,erosion:.06,age:.62},
 oberon:{kind:'icy',temperatureK:70,pressurePa:0,waterFraction:.68,iceFraction:.86,ironFraction:.08,silicateFraction:.24,volatileFraction:.06,sulfurFraction:.005,tectonicActivity:.03,volcanicActivity:0,erosion:.02,age:.88},
 naiad:{kind:'icy',temperatureK:51,pressurePa:0,waterFraction:.62,iceFraction:.84,ironFraction:.06,silicateFraction:.24,volatileFraction:.08,sulfurFraction:.006,tectonicActivity:.04,volcanicActivity:0,erosion:.03,age:.82},
 thalassa:{kind:'icy',temperatureK:51,pressurePa:0,waterFraction:.62,iceFraction:.84,ironFraction:.06,silicateFraction:.24,volatileFraction:.08,sulfurFraction:.006,tectonicActivity:.04,volcanicActivity:0,erosion:.03,age:.82},
 despina:{kind:'icy',temperatureK:51,pressurePa:0,waterFraction:.6,iceFraction:.82,ironFraction:.07,silicateFraction:.26,volatileFraction:.08,sulfurFraction:.006,tectonicActivity:.03,volcanicActivity:0,erosion:.02,age:.86},
 galatea:{kind:'icy',temperatureK:51,pressurePa:0,waterFraction:.6,iceFraction:.82,ironFraction:.07,silicateFraction:.26,volatileFraction:.08,sulfurFraction:.006,tectonicActivity:.03,volcanicActivity:0,erosion:.02,age:.86},
 larissa:{kind:'icy',temperatureK:51,pressurePa:0,waterFraction:.58,iceFraction:.8,ironFraction:.08,silicateFraction:.28,volatileFraction:.08,sulfurFraction:.006,tectonicActivity:.02,volcanicActivity:0,erosion:.02,age:.9},
 proteus:{kind:'icy',temperatureK:51,pressurePa:0,waterFraction:.56,iceFraction:.78,ironFraction:.09,silicateFraction:.3,volatileFraction:.08,sulfurFraction:.006,tectonicActivity:.02,volcanicActivity:0,erosion:.02,age:.9},
 nereid:{kind:'icy',temperatureK:50,pressurePa:0,waterFraction:.5,iceFraction:.72,ironFraction:.1,silicateFraction:.34,volatileFraction:.1,sulfurFraction:.008,tectonicActivity:.02,volcanicActivity:0,erosion:.01,age:.92},
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
  rotationPeriodSeconds:body.rotationPeriodSeconds??null,algorithmVersion:2
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
