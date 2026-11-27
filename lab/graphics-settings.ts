import { createGraphicsSettings, type GraphicsSettings } from '../src/rendering/quality/quality-settings.ts';
import type { QualityLevel } from '../src/rendering/core/render-types.ts';
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T|null;
const preset=$<HTMLSelectElement>('graphics-preset');
const backend=$<HTMLSelectElement>('graphics-backend');
const status=$<HTMLElement>('graphics-status');
const diagnostics=$<HTMLElement>('graphics-diagnostics');
const controls:Record<string,HTMLInputElement|null>={shadows:$<HTMLInputElement>('gfx-shadows'),atmosphere:$<HTMLInputElement>('gfx-atmosphere'),clouds:$<HTMLInputElement>('gfx-clouds'),bloom:$<HTMLInputElement>('gfx-bloom'),glare:$<HTMLInputElement>('gfx-glare'),lensFlare:$<HTMLInputElement>('gfx-lens-flare'),hdr:$<HTMLInputElement>('gfx-hdr')};
const renderScale=$<HTMLSelectElement>('gfx-render-scale');
const msaaSamples=$<HTMLSelectElement>('gfx-msaa-samples');
const atmosphereSamples=$<HTMLSelectElement>('gfx-atmosphere-samples');
const cloudDetail=$<HTMLSelectElement>('gfx-cloud-detail');
const uploadsPerFrame=$<HTMLSelectElement>('gfx-uploads-per-frame');
const STORAGE_KEY='cosmo-riders.graphics.v1';
function load():GraphicsSettings{try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){const saved=JSON.parse(raw) as Partial<GraphicsSettings>;const base=createGraphicsSettings(saved.preset??'high');return{...base,...saved,geodesic:{...base.geodesic,...(saved.geodesic??{})}};}}catch{}return createGraphicsSettings('high');}
let settings=load();
function sync(){if(preset)preset.value=settings.preset;if(backend){backend.value='webgpu';backend.disabled=true;}for(const [key,input]of Object.entries(controls))if(input)input.checked=Boolean(settings[key as keyof GraphicsSettings]);if(renderScale)renderScale.value=String(settings.renderScale);if(msaaSamples)msaaSamples.value=String(settings.msaaSamples>=4?4:1);if(atmosphereSamples)atmosphereSamples.value=String(settings.atmosphereSamples);if(cloudDetail)cloudDetail.value=String(settings.cloudDetail);if(uploadsPerFrame)uploadsPerFrame.value=String(settings.geodesic.uploadsPerFrame);}
function publish(){localStorage.setItem(STORAGE_KEY,JSON.stringify(settings));window.dispatchEvent(new CustomEvent<GraphicsSettings>('graphics-settings-change',{detail:{...settings}}));if(status)status.textContent='Профиль применён: масштаб сцены, качество атмосферы и облаков, лимит загрузки геодезических страниц и постобработка переданы активному WebGPU renderer.';}
preset?.addEventListener('change',()=>{settings=createGraphicsSettings(preset.value as QualityLevel);sync();publish();});
for(const [key,input]of Object.entries(controls))input?.addEventListener('change',()=>{(settings as unknown as Record<string,unknown>)[key]=input.checked;publish();});
renderScale?.addEventListener('change',()=>{settings.renderScale=Number(renderScale.value);publish();});
msaaSamples?.addEventListener('change',()=>{settings.msaaSamples=Number(msaaSamples.value);publish();});
atmosphereSamples?.addEventListener('change',()=>{settings.atmosphereSamples=Number(atmosphereSamples.value);publish();});
cloudDetail?.addEventListener('change',()=>{settings.cloudDetail=Number(cloudDetail.value);publish();});
uploadsPerFrame?.addEventListener('change',()=>{settings.geodesic={...settings.geodesic,uploadsPerFrame:Number(uploadsPerFrame.value)};publish();});
sync();publish();

window.addEventListener('graphics-diagnostics',(event:Event)=>{
 const value=(event as CustomEvent<Record<string,unknown>>).detail;
 if(!diagnostics||!value)return;
 const perf=(value.performance??{}) as Record<string,any>;
 const bytes=(amount:unknown)=>typeof amount==='number'?(amount/1048576).toFixed(2)+' MiB':'—';
 const lines=[
  'ПРОИЗВОДИТЕЛЬНОСТЬ — окно '+(perf.sampleCount??0)+' кадров',
  'FPS: '+(perf.fps??0).toFixed(1)+' · CPU frame: '+(perf.cpuFrameMs??0).toFixed(2)+' ms',
  'Frame interval: avg '+(perf.averageMs??0).toFixed(2)+' · p50 '+(perf.medianMs??0).toFixed(2)+' · p95 '+(perf.p95Ms??0).toFixed(2)+' · peak '+(perf.peakMs??0).toFixed(2)+' ms',
  'GPU frame: '+(perf.gpuTimingSupported?(typeof perf.gpuFrameMs==='number'?perf.gpuFrameMs.toFixed(2)+' ms':'ожидание измерения'):'timestamp-query не поддерживается')+' · GPU utilization: API не предоставляет',
  'Draw calls: '+(perf.drawCalls??0)+' · render passes: '+(perf.renderPasses??0)+' · post FX: '+(perf.postProcessingPasses??0),
  'Bodies: '+(perf.bodyCount??0)+' · surface: '+(perf.surfaceBodyCount??0)+' · atmosphere: '+(perf.atmosphereBodyCount??0)+' · clouds: '+(perf.cloudBodyCount??0)+' ('+(perf.cloudLayerCount??0)+' layers)',
  'Geodesic: '+(perf.visibleGeodesicTiles??0)+' visible tiles · '+(perf.geodesicDrawCalls??0)+' draw calls',
  'Geometry: '+(perf.submittedVertices??0)+' submitted indices/vertices · '+(perf.triangles??0)+' triangles · orbits '+(perf.orbitCount??0)+' · rings '+(perf.ringCount??0),
  'Surface uploads/frame: '+(perf.surfaceUploadsPerFrame??0)+' · backend encode: '+(perf.backendEncodeMs??0).toFixed(2)+' ms',
  'Рендерер: '+value.activeBackend,
  'Архитектура: один canvas, нативный WebGPU',
  'Активный backend: '+value.activeBackend,
  'WebGPU API: '+(value.webgpuAvailable?'доступен':'недоступен'),
  'WebGPU device: '+(value.webgpuState??'—'),
  'WebGPU format: '+(value.webgpuFormat??'—'),
  'WebGPU adapter: '+(value.webgpuAdapterInfo??'не предоставлен'),
  'WebGPU init: '+(typeof value.webgpuInitializationMs==='number'?value.webgpuInitializationMs.toFixed(1)+' ms':'—'),
  'GPU timing: '+(perf.gpuTimingSupported?'timestamp-query активен':'недоступен')+(perf.gpuTimingError?' · '+perf.gpuTimingError:''),
  'WebGPU fallback/error: '+(value.webgpuError??'нет'),
  'WebGPU texture limit: '+(value.maxTextureSize??'—'),
  'Render scale: '+(typeof value.activeRenderScale==='number'?Math.round(value.activeRenderScale*100)+'%':'—')+' · target '+(Array.isArray(value.activeSceneSize)?value.activeSceneSize.join('×'):'—'),
  'MSAA: '+(value.activeMsaaSamples===4?'4x':'1x')+' · '+(value.webgpuError??'без fallback'),
  'GPU cache: '+bytes(value.allocatedBytes)+' выделено · '+bytes(value.residentBytes)+' resident · бюджет '+bytes(value.budgetBytes),
  'GPU pages: '+value.residentPages+'/'+value.capacity+' resident · '+value.freePages+' свободно · '+value.pinnedPages+' закреплено · '+value.unpinnedResidentPages+' вытесняемо',
  'GPU page: '+bytes(value.pageBytes)+' · '+value.pageSize+'² · массивов '+value.allocatedTextureArrays+'/5 · '+(value.ready?'готов':'инициализация'),
  'GPU cache activity: '+value.cacheHitCount+' hits / '+value.cacheMissCount+' misses · '+value.evictionCount+' LRU evictions · uploads '+value.uploadCount+' · errors '+value.uploadFailureCount,
  'GPU cache high-water: '+value.highWaterResidentPages+'/'+value.capacity+' страниц',
  'CPU cache: '+bytes(value.cpuCacheBytes)+' / '+bytes(value.cpuCacheBudgetBytes)+' · '+value.cpuCachePages+' страниц',
  'Страницы: создано '+value.generatedPages+' · visible '+value.visiblePages+' · queued '+value.queuedPages+' · generating '+value.generatingPages+' · failed '+value.failedPages,
  'Worker: '+value.workerActive+'/'+value.workerCount+' активно · очередь '+value.workerQueued+' · перезапуски '+(value.workerRestarts??0),
  'Подготовка нового renderer: '+(value.pendingRendererState??'—'),
  'Ошибка новой конфигурации: '+(value.pendingRendererError??'нет'),
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
