import { createGraphicsSettings, type GraphicsSettings } from '../src/rendering/quality/quality-settings.ts';
import type { QualityLevel } from '../src/rendering/core/render-types.ts';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T|null;
const preset=$<HTMLSelectElement>('graphics-preset');
const status=$<HTMLElement>('graphics-status');
const diagnostics=$<HTMLElement>('graphics-diagnostics');
const controls:Record<string,HTMLInputElement|null>={shadows:$<HTMLInputElement>('gfx-shadows'),atmosphere:$<HTMLInputElement>('gfx-atmosphere'),clouds:$<HTMLInputElement>('gfx-clouds'),bloom:$<HTMLInputElement>('gfx-bloom'),glare:$<HTMLInputElement>('gfx-glare'),lensFlare:$<HTMLInputElement>('gfx-lens-flare'),hdr:$<HTMLInputElement>('gfx-hdr')};
const STORAGE_KEY='cosmo-riders.graphics.v1';
function load():GraphicsSettings{try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){const saved=JSON.parse(raw) as Partial<GraphicsSettings>;const base=createGraphicsSettings(saved.preset??'high');return{...base,...saved};}}catch{}return createGraphicsSettings('high');}
let settings=load();
function sync(){if(preset)preset.value=settings.preset;for(const [key,input]of Object.entries(controls))if(input)input.checked=Boolean(settings[key as keyof GraphicsSettings]);}
function publish(){localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));window.dispatchEvent(new CustomEvent<GraphicsSettings>('graphics-settings-change',{detail:{...settings}}));if(status)status.textContent='Профиль применён: качество рендера, атмосфера, процедурные облака, затмения и тени, Bloom, Glare, Lens Flare и HDR управляются текущими настройками.';}
preset?.addEventListener('change',()=>{settings=createGraphicsSettings(preset.value as QualityLevel);sync();publish();});
for(const [key,input]of Object.entries(controls))input?.addEventListener('change',()=>{(settings as unknown as Record<string,unknown>)[key]=input.checked;publish();});
sync();publish();

window.addEventListener('graphics-diagnostics',(event:Event)=>{
 const value=(event as CustomEvent<Record<string,unknown>>).detail;
 if(!diagnostics||!value)return;
 const bytes=(amount:unknown)=>typeof amount==='number'?(amount/1048576).toFixed(2)+' MiB':'—';
 const lines=[
  'WebGL2: '+(value.webgl2?'доступен':'недоступен'),
  'MAX_ARRAY_TEXTURE_LAYERS: '+value.maxArrayTextureLayers,
  'MAX_TEXTURE_SIZE: '+value.maxTextureSize,
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS: '+value.maxVertexTextureImageUnits,
  'MAX_TEXTURE_IMAGE_UNITS: '+value.maxFragmentTextureImageUnits,
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS: '+value.maxCombinedTextureImageUnits,
  'MAX_VERTEX_UNIFORM_VECTORS: '+value.maxVertexUniformVectors,
  'MAX_FRAGMENT_UNIFORM_VECTORS: '+value.maxFragmentUniformVectors,
  'MAX_VERTEX_ATTRIBS: '+value.maxVertexAttributes,
  'Extensions: '+((value.extensions as string[]|undefined)?.join(', ')||'не требуются для геодезической поверхности'),
  'Режим Земли: '+value.active+' ('+value.mode+')',
  'GPU cache: '+bytes(value.gpuCacheBytes)+' · '+value.gpuResidentPages+'/'+value.gpuLayers+' слоёв · закреплено '+value.gpuPinnedPages,
  'Одна GPU-страница: '+bytes(value.pageBytes)+' · размер '+value.pageSize+'²',
  'CPU cache: '+bytes(value.cpuCacheBytes)+' · '+value.cpuCachePages+' страниц',
  'Страницы: создано '+value.generatedPages+'/20 · загружено '+value.uploadedPages,
  'Worker: '+value.workerActive+'/'+value.workerCount+' активно · очередь '+value.workerQueued,
  'Ошибки Worker startup/runtime/task: '+value.workerStartupErrors+'/'+value.workerRuntimeErrors+'/'+value.workerTaskErrors,
  'Задачи отменены/dispose: '+value.cancelledTasks+'/'+value.disposedTasks,
  'Генерация mesh/surface: '+value.meshGenerationMs+' / '+value.surfaceGenerationMs+' ms',
  'Ошибки renderer/upload: '+value.rendererErrors+'/'+value.uploadErrors+' · отказов renderer '+value.rendererFailureCount,
  'Первичная ошибка: '+(value.firstFailure??'нет'),
  'Тип/ключ ошибки: '+(value.failureTaskKind??'—')+' / '+(value.failureTaskKey??'—'),
  'Время ошибки: '+(typeof value.failureTimestamp==='number'?new Date(value.failureTimestamp).toLocaleString():'—'),
  'Причина UV fallback: '+value.fallbackReason
 ];
 diagnostics.textContent=lines.join('\n');
});
