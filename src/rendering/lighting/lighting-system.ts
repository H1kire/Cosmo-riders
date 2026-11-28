import{LightingEngine}from'../../presentation/lighting-engine.ts';import{LightSource,type LightSourceOptions}from'./light-source.ts';export class LightingSystem extends LightingEngine{private sources=new Map<string,LightSource>();addSource(o:LightSourceOptions){const s=new LightSource(o);this.sources.set(s.id,s);if(s.kind==='point')this.setPointLight(s.id,[...s.position],{intensity:s.intensity,color:[...s.color]});return s;}updateSource(id:string,p:Partial<Omit<LightSourceOptions,'id'>>){const o=this.sources.get(id);if(!o)throw Error('Unknown light: '+id);return this.addSource({id,kind:p.kind??o.kind,position:p.position??o.position,direction:p.direction??o.direction,color:p.color??o.color,intensity:p.intensity??o.intensity,rangeM:p.rangeM??o.rangeM});}removeSource(id:string){this.sources.delete(id);this.removeLight(id);}getSources(){return[...this.sources.values()];}}
/** Exposure compensation for the focused body's heliocentric distance; light itself remains inverse-square. */
/** Display-only gain for distant planetary surfaces; physical irradiance remains inverse-square. */
export function planetaryDisplayGain(distanceAU:number):number {
 if(!Number.isFinite(distanceAU)||distanceAU<=0)return 1;
 return Math.max(1,Math.min(64,Math.pow(distanceAU,1.5)));
}
/** Kept as a compatibility helper: global camera exposure must not follow the focused body. */
export function focusedSolarExposureMultiplier(_distanceAU:number):number {
 return 1;
}


/** Відображувана опроміненість: фізичний спад 1/r² із обмеженою компенсацією HDR для дальніх тіл. */
export function solarIrradianceForDisplay(distanceAU:number):number {
 if(!Number.isFinite(distanceAU)||distanceAU<=0)return 1;
 const distance=Math.max(distanceAU,0.05);
 // Фізичний спад 1/r² зберігається; окремий обмежений display gain стискає
 // міжпланетний HDR-діапазон, щоб зовнішні тіла не губили деталі після tone mapping.
 return planetaryDisplayGain(distance)/(distance*distance);
}
