import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { planetaryOrbitOpacity, planetaryLabelOpacity, projectedOrbitRadius, selectMeshLod } from '../src/rendering/quality/render-lod.ts';
import { dirname, join, resolve } from 'node:path';

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const checks: Array<[string, () => Promise<void>]> = [
  ['Browser entry points, DOM hooks and local imports are compatible', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    const labHtml = await readFile(new URL('../lab/index.html', import.meta.url), 'utf8');
    const app = await readFile(new URL('../lab/lab.ts', import.meta.url), 'utf8');
    const css = await readFile(new URL('../lab/style.css', import.meta.url), 'utf8');
    if (!html.includes('id="solar-view"') || !html.includes('src="./lab/main.ts"')) throw new Error('Root page is missing the solar canvas or TypeScript entry point.');
    if (!html.includes('id="menu-toggle"') || !html.includes('id="app-sidebar"') || !html.includes('id="window-settings"') || !html.includes('id="graphics-preset"') || !html.includes('src="./lab/graphics-settings.ts"') || !html.includes('src="./lab/menu.ts"')) throw new Error('Published root page must expose the menu and graphics settings modules.');
    if (!labHtml.includes('id="solar-view"') || !labHtml.includes('src="./main.ts"')) throw new Error('Lab page is missing the solar canvas or TypeScript entry point.');
    if (!html.includes('href="./lab/style.css"') || !labHtml.includes('href="./style.css"')) throw new Error('A page stylesheet path is broken.');
    for (const match of app.matchAll(/\$\('([^']+)'\)/g)) {
      const id = match[1];
      if (id !== 'window-system' && !html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) throw new Error('Missing DOM element id: ' + id);
    }
    if (css.includes('\\n.body-label-layer')) throw new Error('A literal escaped newline breaks the map overlay stylesheet.');
    if (app.includes('drawFallbackSolar()') || app.includes('activateSolarFallback(error)') || app.includes('fallbackCanvas')) throw new Error('The solar view must not switch to a Canvas fallback.');
    if (!app.includes('reportSolarRenderFailure(error)') || !app.includes('WebGPU недоступен')) throw new Error('WebGPU startup failures must be reported without changing renderers.');
  }],
  ['Every local TypeScript import resolves to a tracked source file', async () => {
    async function collectTypeScript(directory: string): Promise<string[]> {
      const entries = await readdir(directory, { withFileTypes: true });
      const paths: string[] = [];
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) paths.push(...await collectTypeScript(path));
        else if (entry.isFile() && path.endsWith('.ts')) paths.push(path);
      }
      return paths;
    }
    const files = await collectTypeScript(root.pathname);
    const known = new Set(files.map(file => resolve(file)));
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const match of source.matchAll(/^\s*import\s+(?:[^;\n]*?\s+from\s*)?["'](\.{1,2}\/[^"']+)["']/gm)) {
        const target = resolve(dirname(file), match[1]);
        const candidates = /\.[cm]?tsx?$/.test(target) ? [target] : target.endsWith('.js') ? [target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.d.ts')] : [target + '.ts', target + '.tsx', join(target, 'index.ts')];
        if (!candidates.some(candidate => known.has(resolve(candidate)))) throw new Error('Unresolved import in ' + file.replace(root.pathname, '') + ': ' + match[1]);
      }
    }
  }],
  ['Visual Engine 0.2 architecture and graphics controls', async () => {
    const required = ['core/render-engine.ts','core/render-pipeline.ts','core/render-target.ts','core/shader-manager.ts','lighting/lighting-system.ts','lighting/shadow-system.ts','lighting/eclipse-system.ts','atmosphere/atmosphere-system.ts','atmosphere/scattering.ts','atmosphere/cloud-system.ts','atmosphere/atmosphere-material.ts','effects/bloom.ts','effects/glare.ts','effects/lens-flare.ts','effects/tone-mapping.ts','materials/planet-material.ts','materials/star-material.ts','materials/ring-material.ts','materials/surface-material.ts','quality/quality-settings.ts','quality/adaptive-quality.ts','environment/environment-systems.ts'];
    for (const path of required) await readFile(new URL('../src/rendering/' + path, import.meta.url), 'utf8');
    const settings = await readFile(new URL('../lab/graphics-settings.ts', import.meta.url), 'utf8');
    const graphicsHtml = await readFile(new URL('../lab/index.html', import.meta.url), 'utf8');
    if (!settings.includes('graphics-settings-change') || !settings.includes('localStorage')) throw new Error('Graphics settings must persist and publish changes.');
    if (!graphicsHtml.includes('id="window-settings"') || !graphicsHtml.includes('id="graphics-preset"') || !graphicsHtml.includes('src="./graphics-settings.ts"')) throw new Error('Graphics settings UI is incomplete.');
    const compatibility = await readFile(new URL('../src/rendering/lighting/lighting-system.ts', import.meta.url), 'utf8');
    if (!compatibility.includes('extends LightingEngine')) throw new Error('New lighting system must preserve the legacy LightingEngine API.');
  }],
  ['Continuous shader-generated planetary surfaces', async () => {
    const renderer = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
    const shader = await readFile(new URL('../src/rendering/shaders/planet-surface.ts', import.meta.url), 'utf8');
    if (renderer.includes('createSurfaceProfile') || renderer.includes('SurfaceMapCache') || renderer.includes('requestSurfaceMaps') || renderer.includes('processSurfaceUploads')) throw new Error('Legacy CPU cubemap generation must not be active in the solar renderer.');
    for (const feature of ['domainWarp3','ridged3','float land=smoothstep(0.486,0.516,continentField)','float softBelts=smoothstep(-0.48,0.58,belts)']) if (!shader.includes(feature)) throw new Error('Shader terrain feature is missing: '+feature);
    if (shader.includes('samplerCube') || shader.includes('uGeneratedAlbedo') || shader.includes('uPreviousAlbedo')) throw new Error('Planet surfaces must not depend on generated cube-map textures.');
    const albedoStart=shader.indexOf('vec3 surfaceAlbedo'),albedoEnd=shader.indexOf('float distributionGGX',albedoStart),albedo=shader.slice(albedoStart,albedoEnd),common=albedo.slice(0,albedo.indexOf('if(uKind<0.5)'));
    if(/fbm3|ridged3|domainWarp3/.test(common)||albedo.includes('float tectonics=')||albedo.includes('float ridges='))throw new Error('Material noise must be evaluated inside only the material branch that consumes it.');
    const body = await readFile(new URL('../src/physics/celestial-body.ts', import.meta.url), 'utf8');
    if (!body.includes('surfaceSeed') || !body.includes('Number.isSafeInteger(surfaceSeed)')) throw new Error('Celestial bodies must support persisted deterministic surface seeds.');
  }],
  ['SI unit constants', async () => {
    const source = await readFile(new URL('../src/physics/constants.ts', import.meta.url), 'utf8');
    if (!source.includes('G = 6.67430e-11') || !source.includes('AU = 149_597_870_700')) throw new Error('Expected SI constants are missing.');
  }],
  ['No runtime dependencies', async () => {
    if (Object.keys(pkg.dependencies ?? {}).length !== 0) throw new Error('Physics core must remain dependency-free.');
  }],
  ['No hard-coded NaN or Infinity defaults', async () => {
    const source = await readFile(new URL('../src/physics/kepler.ts', import.meta.url), 'utf8');
    if (/\b(?:NaN|Infinity)\b/.test(source)) throw new Error('Unexpected NaN/Infinity literal in Kepler solver.');
  }],
  ['Hierarchical map uses physical satellite offsets', async () => {
    const source = await readFile(new URL('../lab/lab.ts', import.meta.url), 'utf8');
    if (source.includes('solarMoonScreenPoint')) throw new Error('Synthetic Moon screen offset must not be used.');
    if (!source.includes('targetState.position.x-focusState.position.x')) throw new Error('Local view must use physical parent-relative coordinates.');
    if (!source.includes('LOCAL_VIEW_START_ZOOM')) throw new Error('Hierarchical local-view transition is missing.');
    if (!source.includes('world.orbitPaths.get(id)') || source.includes('orbitalElementsToState') || source.includes('rotateStateToParentEquator')) throw new Error('Orbit paths must come from Rust-generated orbital samples.');
  }],
  ['3D renderer submits the live solar-system scene through WebGPU', async () => {
    const source = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
    const backend = await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts', import.meta.url), 'utf8');
    if (!source.includes('new WebGPUBackend(canvas)') || !source.includes('this.webgpuBackend.render(') || !source.includes('webgpuBodies.push({id:body.id,model,...webgpuBody})')) throw new Error('Live simulation bodies and transforms must be submitted to the native WebGPU renderer.');
    if (!source.includes('this.webgpuOrbits.push(') || !source.includes('this.webgpuRings.push(') || !source.includes('webgpuDraw.atmosphere=') || !source.includes('webgpuDraw.clouds=')) throw new Error('Orbits, rings, atmospheres and clouds must be part of the WebGPU scene frame.');
    if (!backend.includes("getContext('webgpu')") || !backend.includes('requestAdapter') || !backend.includes('requestDevice') || !backend.includes('createRenderPipelineAsync')) throw new Error('WebGPU device, canvas context and render pipelines must be initialized natively.');
    if (!backend.includes('const SHADER') || !backend.includes('const RING_SHADER') || !backend.includes('const ORBIT_SHADER') || !backend.includes('private encodePost')) throw new Error('WebGPU must own planetary, ring, orbit and post-processing pipelines.');
    if (!backend.includes('surfaceShadowVisibility') || !backend.includes('shadowOccluders') || !backend.includes('angularDiskOverlap') || !backend.includes('ringParams')) throw new Error('WebGPU surface shading must use per-fragment finite-disc eclipses and ring-plane shadows.');
    if (!backend.includes('surfaceParams') || !backend.includes('body.surfaceParams.x') || !backend.includes('body.surfaceParams.y') || !backend.includes('cloudField(') || !backend.includes('cloudVolume(')) throw new Error('WebGPU materials must consume geological properties and advected volumetric cloud density fields.');
    if (source.includes('HDRPipeline') || source.includes('this.hdr.begin') || source.includes('this.hdr.present') || source.includes('RingRenderer') || source.includes('lineProgram')) throw new Error('Legacy HDR, ring and orbit presentation paths must not remain in Solar3DView.');
    if (!source.includes('mapPosition(p):[number,number,number]{return[p.x/AU,p.z/AU,p.y/AU];}') || !source.includes('const renderOrigin=focusState?focusState.position:sun;') || !source.includes('const mapper=(body,p,out?:[number,number,number])=>') || !source.includes('const x=(p.x-renderOrigin.x)/AU,y=(p.z-renderOrigin.z)/AU,z=(p.y-renderOrigin.y)/AU') || !source.includes('this.target=this.focusOffset.slice();') || !source.includes('radius=body.meanRadiusM/AU')) throw new Error('Solar renderer must use true AU distances and physical radii with a high-precision camera-relative origin.');
    if (!source.includes('Math.max(radius,viewDistance)')) throw new Error('Projected LOD radius must use physical camera distance without a fixed-distance clamp.');
    if (!source.includes('TEXTURE_DETAIL_CAPS={low:.65,medium:.95,high:1.25,ultra:1.5}') || !source.includes('this.graphics.textureQuality')) throw new Error('Texture quality preset must control procedural surface detail.');
    if (!source.includes('const far=100;') || !source.includes('const clearance=Math.max(0,cameraRadius-radius)') || !source.includes('clearance>0?clearance*.1:cameraRadius*.001')) throw new Error('Focused planetary views must retain the 100 AU scene range and adapt the near plane to actual surface clearance.');
    if (source.includes('if(vesselState?.position)') || source.includes('shipDistance*8*Math.tan(Math.PI/6)/h')) throw new Error('Spacecraft rendering must remain disabled while the project is focused on the solar system.');
    const surface = await readFile(new URL('../src/rendering/shaders/planet-surface.ts', import.meta.url), 'utf8');
    if (!surface.includes('uLightPositions[4]') || !surface.includes('uLightIntensities[i]/(22.0*distanceSquared)') || !surface.includes('distributionGGX') || !surface.includes('geometrySchlick') || !surface.includes('surfaceAlbedo')) throw new Error('Retained surface reference must preserve inverse-square multi-light shading and PBR material logic.');
    if (!source.includes("this.lighting.updateSource('sun',{position:sunRenderPosition})") || !source.includes('sunPosition:sunRenderPosition') || !backend.includes('frame.sunPosition')) throw new Error('The active WebGPU renderer must receive the simulation star position through its lighting input.');
    if (!source.includes('collectOccluders(') || !source.includes('calculateEclipse(') || !source.includes('this.graphics.shadows')) throw new Error('Simulation occluders and analytic eclipse calculations must remain connected to the WebGPU scene.');
    if (!source.includes('this.lighting.addSource({id:\'sun\',kind:\'point\'') || !source.includes('setStellarSource(id:string,positionSI:[number,number,number]') || !source.includes('for(const [id,source] of this.stellarSourceDefinitions)')) throw new Error('Lighting engine must preserve the primary star and support additional point sources.');
    if (!source.includes('opacity*=planetaryOrbitOpacity(bodyDistance,body.meanRadiusM/AU)') || !source.includes('this.drawOrbit(world,body,states,sun,vp,mapper,1,eye,h,bodyDistance,renderOrigin)') || source.includes('planetOrbitFade') || source.includes('localMode')) throw new Error('Each orbit must share its own body label distance curve in the common scene.');
    const orbitLod = await readFile(new URL('../src/rendering/quality/render-lod.ts', import.meta.url), 'utf8');
    if (!backend.includes('const levels: Array<[number, number]> = [[10, 14], [22, 30], [44, 60], [128, 192]]') || !backend.includes('body.lod') || !source.includes('selectMeshLod(px,this.graphics.maxMeshLod)') || !source.includes('Math.log2(Math.max(1,px)/18)') || !source.includes('Math.min(1024') || !source.includes('smoothVisibility') || !source.includes('orbitSegmentCounts') || !source.includes('orbitVisibilityStates') || source.includes('this.orbitBuffers') || source.includes('bufferSubData') || !orbitLod.includes('(ratio-120)/(2400-120)') || !orbitLod.includes('projectedOrbitRadius')) throw new Error('WebGPU sphere LOD or stable adaptive orbit rendering is missing.');
    if (!surface.includes('pow(uColor,vec3(2.2))') || !surface.includes('fbm3Filtered') || !surface.includes('fwidth(p.x)')) throw new Error('Retained material reference must preserve linear-light conversion and filtered procedural detail.');
  }],
  ['Runtime LOD helpers match the current orbit and mesh policies', async () => {
    if (selectMeshLod(8,3)!==0 || selectMeshLod(40,3)!==1 || selectMeshLod(180,3)!==2 || selectMeshLod(900,3)!==3) throw new Error('Projected mesh LOD thresholds are incorrect.');
    const radius=6371000/149597870700;
    if (planetaryOrbitOpacity(radius*20,radius)!==0 || planetaryOrbitOpacity(radius*120,radius)!==0 || planetaryOrbitOpacity(radius*2400,radius)!==1) throw new Error('Heliocentric orbit fade thresholds are incorrect.');
    if (!(projectedOrbitRadius(0.0026,1080,38)<0.8) || !(projectedOrbitRadius(0.0026,1080,0.00001)>100)) throw new Error('Projected orbit radius does not respond continuously to camera distance.');
  }],
  ['Start menu gates both published entry points before the loading bootstrap', async () => {
    const rootPage=await readFile(new URL('../index.html',import.meta.url),'utf8');
    const labPage=await readFile(new URL('../lab/index.html',import.meta.url),'utf8');
    const main=await readFile(new URL('../lab/main.ts',import.meta.url),'utf8');
    const loader=await readFile(new URL('../lab/loading-screen.ts',import.meta.url),'utf8');
    for(const [name,page] of [['root',rootPage],['lab',labPage]] as const){
      if(!page.includes('id="start-screen"')||!page.includes('id="start-simulation"'))throw new Error(name+' page is missing the start menu.');
      if(!page.includes('class="loading-screen is-hidden"')||!page.includes('id="loading-progress"'))throw new Error(name+' page must keep the existing loading screen hidden until entry.');
      if(!page.includes('id="graphics-diagnostics"'))throw new Error(name+' page is missing live graphics diagnostics.');
    }
    if(!/startButton\.addEventListener\('click',\(\)=>\{[\s\S]*?loading\.show\(\);[\s\S]*?void startApplication\(\);/.test(main)||!/async function startApplication\(\):Promise<void>\{[\s\S]*?await loading\.nextFrame\(\);[\s\S]*?await import\('\.\/lab\.ts'\)/.test(main))throw new Error('Start action must reveal LoadingScreen before invoking the bootstrap that dynamically imports the application.');
    if(!loader.includes("this.root?.classList.remove('is-hidden','is-ready')")||!loader.includes("this.root?.classList.add('is-hidden')"))throw new Error('LoadingScreen must retain explicit show and ready transitions.');
    if(!rootPage.includes('src="./lab/main.ts"')||!labPage.includes('src="./main.ts"'))throw new Error('Published entry-point module paths are inconsistent.');
  }],
  ['Active WebGPU geodesic pipeline budgets pages, meshes and worker uploads', async () => {
    const quality=await readFile(new URL('../src/rendering/quality/quality-settings.ts',import.meta.url),'utf8');
    const system=await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-system.ts',import.meta.url),'utf8');
    const pages=await readFile(new URL('../src/rendering/webgpu/webgpu-surface-page-cache.ts',import.meta.url),'utf8');
    const renderer=await readFile(new URL('../src/rendering/webgpu/webgpu-geodesic-surface-renderer.ts',import.meta.url),'utf8');
    const surfaceRuntime=await readFile(new URL('../src/rendering/webgpu/webgpu-surface-runtime.ts',import.meta.url),'utf8');
    const manager=await readFile(new URL('../src/rendering/geodesic/virtual-surface-manager.ts',import.meta.url),'utf8');
    const solar=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
    const backend=await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8');
    const meshWorker=await readFile(new URL('../src/rendering/geodesic/surface-tile-worker.ts',import.meta.url),'utf8');
    const pool=await readFile(new URL('../src/rendering/geodesic/surface-worker-pool.ts',import.meta.url),'utf8');
    const meshSource=await readFile(new URL('../src/rendering/geodesic/tile-mesh.ts',import.meta.url),'utf8');
    for(const level of ['low','medium','high','ultra']){
      if(!quality.includes(level+':{pageResolution:')||!quality.includes('geodesic:GEODESIC_QUALITY_PRESETS.'+level))throw new Error('Missing geodesic quality profile: '+level);
    }
    if(!backend.includes('new WebGPUGeodesicSurfaceSystem')||!backend.includes('geodesicSystem.drawBody(')||!system.includes('WebGPUGeodesicSurfaceRenderer.create('))throw new Error('The live WebGPU backend must own the active geodesic renderer and draw path.');
    if(!system.includes('this.uploadsRemainingThisFrame=this.settings.uploadsPerFrame')||!system.includes('this.pages.initializeStep()')||!system.includes('runtime.requestTileMesh(')||!system.includes('settings.gpuBudgetBytes')||!system.includes('settings.cpuBudgetBytes'))throw new Error('The active geodesic system must incrementally allocate pages and bound uploads, CPU memory and GPU memory.');
    if(!pages.includes('maxTextureDimension2D')||!pages.includes('maxTextureArrayLayers')||!pages.includes('initializeStep(): boolean')||!pages.includes('this.capacity = Math.min(maxLayers, maxPages, Math.floor(budgetBytes / bytesPerPage))'))throw new Error('The active WebGPU page cache must validate texture-array limits and allocate within its memory budget.');
    if(!surfaceRuntime.includes('this.manager.requestMesh(')||!manager.includes('this.cpuBudgetBytes')||!manager.includes('this.pool.requestMesh(')||!pool.includes('maxPendingTasks'))throw new Error('CPU mesh generation and cached surface data must use the bounded shared worker pool.');
    if(!meshWorker.includes("kind:'mesh'")||!meshWorker.includes('build_geodesic_tile_mesh(')||!meshWorker.includes('transferables(arrays)')||!meshWorker.includes('await ensureWasm()')||!meshSource.includes('resolution>64'))throw new Error('Mesh workers must build the real WASM geodesic mesh and transfer bounded arrays.');
    if(!renderer.includes('pass.drawIndexed(')||!renderer.includes('binding: 5')||!system.includes('rendererInitializationError'))throw new Error('The active WebGPU geodesic renderer must draw indexed meshes with the five-channel page data and preserve initialization errors.');
    if(solar.includes('rebuildGeodesicRenderer')||solar.includes('GeodesicPlanetRenderer')||solar.includes("getContext('webgl2')")||!solar.includes("window.dispatchEvent(new CustomEvent('graphics-diagnostics'")||!solar.includes('this.requestedGraphics={...this.requestedGraphics,...value,geodesic:')||!solar.includes('this.graphics=this.applyAdaptiveGraphics(this.requestedGraphics)'))throw new Error('Solar3DView must stay on the single WebGPU path and publish live adaptive graphics diagnostics.');
    if(!solar.includes("const canvas=this.canvas;canvas.classList.add('solar-webgpu-canvas')")||solar.includes("getContext('webgl2')")||!pages.includes('initializeStep(): boolean'))throw new Error('Solar3DView must use one WebGPU canvas with incremental surface allocation and no WebGL2 fallback.');
    if(!solar.includes('readonly ready:Promise<void>')||!solar.includes('private async initialize():Promise<void>')||!solar.includes('await this.yieldToBrowser()')||!solar.includes('1920*1080')||solar.includes("getContext('webgl2')")||!solar.includes('PerformanceObserver')||!solar.includes('longestSynchronousChunkMs')||!solar.includes('longestLongTaskMs'))throw new Error('Native WebGPU initialization must expose optional Long Task diagnostics, enforce a conservative render-pixel budget and avoid WebGL contexts.');
    const qualitySettings=await readFile(new URL('../src/rendering/quality/quality-settings.ts',import.meta.url),'utf8');
    if(!qualitySettings.includes('ultra:{pageResolution:160,meshResolution:64')||qualitySettings.includes('meshResolution:96'))throw new Error('Every graphics preset must stay within the stitcher resolution contract.');
    if(planetaryLabelOpacity(1000,10)!==planetaryOrbitOpacity(1000,10)||!solar.includes('node.style.opacity=String(labelOpacity)')||solar.includes('projectedFade'))throw new Error('Planet labels and orbit lines must share one smooth fade without a projected-radius cutoff.');
    if(!system.includes('rendererInitializationError')||!pool.includes('rejectQueuedWithoutWorkers')||!pool.includes('reply?.type===\'ready\'')||!pool.includes('this.maxWorkerRestarts'))throw new Error('WebGPU geodesic failures must preserve the first renderer error and bound worker restarts.');
  }],
  ['Rendering uses non-mutating fractional snapshots', async () => {
    const physics = await readFile(new URL('../src/physics/physics-world.ts', import.meta.url), 'utf8');
    const lab = await readFile(new URL('../lab/lab.ts', import.meta.url), 'utf8');
    if (!physics.includes('getBodyStatesAt(') || !physics.includes('getVesselStateAt(')) throw new Error('Fractional state snapshot APIs are missing.');
    const worker = await readFile(new URL('../src/wasm/physics/physics-worker.ts', import.meta.url), 'utf8');
    const client = await readFile(new URL('../src/wasm/physics/physics-world-client.ts', import.meta.url), 'utf8');
    if (!worker.includes('get_body_states_at(renderTime)') || !worker.includes('get_vessel_state_at(id,renderTime,renderBodyStates)') || !client.includes('result.renderBodyStates') || !lab.includes('await world.advance(delta)') || !lab.includes('world.renderBodyStates')) throw new Error('Renderer is not consuming synchronized Rust/WASM interpolation snapshots from its single physics worker.');
  }]
];

let failed = 0;
for (const [name, run] of checks) {
  try { await run(); process.stdout.write('PASS ' + name + '\n'); }
  catch (error) { failed += 1; process.stderr.write('FAIL ' + name + ': ' + error.message + '\n'); }
}

async function collectJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) paths.push(...await collectJavaScript(path));
    else if (entry.isFile() && path.endsWith('.js') && !path.endsWith('/audit.js')) paths.push(path);
  }
  return paths;
}
const jsFiles = await collectJavaScript(root.pathname);
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status === 0) process.stdout.write('PASS syntax ' + file.replace(root.pathname, '') + '\n');
  else { failed += 1; process.stderr.write('FAIL syntax ' + file + ': ' + result.stderr + '\n'); }
}
if (failed) process.exitCode = 1;
else process.stdout.write('AUDIT PASSED (' + jsFiles.length + ' remaining runtime JavaScript files; TypeScript is checked by tsc)\n');