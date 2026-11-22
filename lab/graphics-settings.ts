import { createGraphicsSettings, type GraphicsSettings, type QualityLevel } from '../src/rendering/quality/quality-settings.ts';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T|null;
const preset=$<HTMLSelectElement>('graphics-preset');
const status=$<HTMLElement>('graphics-status');
const controls:Record<string,HTMLInputElement|null>={shadows:$<HTMLInputElement>('gfx-shadows'),atmosphere:$<HTMLInputElement>('gfx-atmosphere'),clouds:$<HTMLInputElement>('gfx-clouds'),bloom:$<HTMLInputElement>('gfx-bloom'),glare:$<HTMLInputElement>('gfx-glare'),lensFlare:$<HTMLInputElement>('gfx-lens-flare'),hdr:$<HTMLInputElement>('gfx-hdr')};
const STORAGE_KEY='cosmo-riders.graphics.v1';
function load():GraphicsSettings{try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){const saved=JSON.parse(raw) as Partial<GraphicsSettings>;const base=createGraphicsSettings(saved.preset??'high');return{...base,...saved};}}catch{}return createGraphicsSettings('high');}
let settings=load();
function sync(){if(preset)preset.value=settings.preset;for(const [key,input]of Object.entries(controls))if(input)input.checked=Boolean(settings[key as keyof GraphicsSettings]);}
function publish(){localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));window.dispatchEvent(new CustomEvent<GraphicsSettings>('graphics-settings-change',{detail:{...settings}}));if(status)status.textContent='Профиль сохранён. Архитектура графики подключена; визуальные эффекты будут включаться по мере реализации этапов 0.2.';}
preset?.addEventListener('change',()=>{settings=createGraphicsSettings(preset.value as QualityLevel);sync();publish();});
for(const [key,input]of Object.entries(controls))input?.addEventListener('change',()=>{(settings as unknown as Record<string,unknown>)[key]=input.checked;publish();});
sync();publish();
