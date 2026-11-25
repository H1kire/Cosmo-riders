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
    if (!app.includes('drawFallbackSolar()') || !app.includes('activateSolarFallback(error)')) throw new Error('A non-WebGL map fallback is missing.');
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
    if (!source.includes('orbitalElementsToState')) throw new Error('Orbit paths must use orbital elements.');
  }],
  ['3D renderer uses WebGL, orbit geometry and adaptive mesh LOD', async () => {
    const source = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
    if (!source.includes("getContext('webgl2'") || !source.includes('makeSphere(g,44,60)') || !source.includes('removeEventListener(\'graphics-settings-change\',this.graphicsChangeHandler)') || !source.includes('this.hdr?.dispose()') || !source.includes('g.deleteBuffer(buffer)') || !source.includes('g.deleteProgram(program)')) throw new Error('WebGL2 renderer or high-detail sphere mesh is missing.');
    if (!source.includes('new HDRPipeline(') || !source.includes('this.hdr.begin(renderWidth,renderHeight)') || !source.includes('this.hdr.present(w,h)')) throw new Error('Solar scene must render through the HDR scene target and final post-process pass.');
    const hdr = await readFile(new URL('../src/rendering/core/hdr-pipeline.ts', import.meta.url), 'utf8');
    if (!hdr.includes('EXT_color_buffer_float') || !hdr.includes('RGBA16F') || !hdr.includes('HALF_FLOAT')) throw new Error('HDR pipeline must allocate floating-point RGBA16F render targets when supported.');
    if (!hdr.includes('renderbufferStorageMultisample') || !hdr.includes('blitFramebuffer') || !hdr.includes('scene.msaaFramebuffer??this.scene.framebuffer')) throw new Error('The HDR scene must use multisample rendering with a resolved texture for post-processing.');
    if (!hdr.includes('const bw=width,bh=height,blurWidth=Math.max(1,Math.floor(width*0.75))') || !hdr.includes('this.bright=target(this.gl,bw,bh,this.activeHdr)')) throw new Error('Bloom extraction must retain full scene resolution before its blur downsample.');
    if (!hdr.includes('if(depth&&!msaaFramebuffer)') || !hdr.includes('gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,w,h)') || !hdr.includes('if(msaaColorBuffer)gl.deleteRenderbuffer(msaaColorBuffer)')) throw new Error('HDR fallback must retain a depth attachment and release partial MSAA allocations.');
    if (!hdr.includes('const BRIGHT') || !hdr.includes('const BLUR') || !hdr.includes('const COMPOSITE') || !hdr.includes('uBloomStrength') || !hdr.includes('aces(')) throw new Error('HDR pipeline must execute bright extraction, blur and tone-mapped composite passes.');
    if (!source.includes('mapPosition(p):[number,number,number]{return[p.x/AU,p.z/AU,p.y/AU];}') || !source.includes('const renderOrigin=focusState?focusState.position:sun;') || !source.includes('const mapper=(body,p,out?:[number,number,number])=>') || !source.includes('const x=(p.x-renderOrigin.x)/AU,y=(p.z-renderOrigin.z)/AU,z=(p.y-renderOrigin.y)/AU') || !source.includes('this.target=this.focusOffset.slice();') || !source.includes('radius=body.meanRadiusM/AU')) throw new Error('Solar renderer must use true AU distances and physical radii with a high-precision camera-relative origin.');
    if (!source.includes('Math.max(radius,viewDistance)')) throw new Error('Projected LOD radius must use physical camera distance without a fixed-distance clamp.');
    if (!source.includes('TEXTURE_DETAIL_CAPS={low:.65,medium:.95,high:1.25,ultra:1.5}') || !source.includes('this.graphics.textureQuality')) throw new Error('Texture quality preset must control procedural surface detail.');
    if (!source.includes('const far=100,near=Math.max(1e-10,Math.min(this.distance*.01,focusRadius>0?focusRadius*.02:this.distance*.01))')) throw new Error('Focused planetary views must retain the 100 AU scene range and adapt the near plane to camera and body scale.');
    if (source.includes('if(vesselState?.position)') || source.includes('shipDistance*8*Math.tan(Math.PI/6)/h')) throw new Error('Spacecraft rendering must remain disabled while the project is focused on the solar system.');
    const surface = await readFile(new URL('../src/rendering/shaders/planet-surface.ts', import.meta.url), 'utf8');
    if (!surface.includes('uLightPositions[4]') || !surface.includes('uLightIntensities[i]/(22.0*distanceSquared)') || !surface.includes('distributionGGX') || !surface.includes('geometrySchlick') || !surface.includes('surfaceAlbedo')) throw new Error('Planetary materials must use inverse-square multi-light shading, microfacet specular and distinct surface maps.');
    if (!surface.includes('vec3 indirect=albedo*0.0001') || !surface.includes('uSunRadius*along/max(sunDistance-along,1e-12)')) throw new Error('Planetary night-side floor or stellar angular penumbra is not physically bounded.');
    const extractBlock=(marker:string):string=>{
      const markerIndex=source.indexOf(marker);
      if(markerIndex<0)throw new Error('Render-state block is missing: '+marker);
      const open=source.indexOf('{',markerIndex);
      let depth=0,quote='',escaped=false,lineComment=false,blockComment=false;
      for(let i=open;i<source.length;i++){
        const char=source[i],next=source[i+1];
        if(lineComment){if(char==='\n')lineComment=false;continue;}
        if(blockComment){if(char==='*'&&next==='/'){blockComment=false;i++;}continue;}
        if(quote){if(escaped){escaped=false;continue;}if(char==='\\'){escaped=true;continue;}if(char===quote)quote='';continue;}
        if(char==='/'&&next==='/'){lineComment=true;i++;continue;}
        if(char==='/'&&next==='*'){blockComment=true;i++;continue;}
        if(char==='"'||char==="'"){quote=char;continue;}
        if(char==='{')depth++;
        else if(char==='}'&&--depth===0)return source.slice(open,i+1);
      }
      throw new Error('Unbalanced render-state block: '+marker);
    };
    const planetLoop=extractBlock('for(const body of bodies){\n   g.useProgram(this.bodyProgram);');
    if(!/^\{\s*g\.useProgram\(this\.bodyProgram\);\s*const state=states\.get\(body\.id\);/.test(planetLoop)) throw new Error('Each planet iteration must bind the surface program before any early exit or draw.');
    if(!/if\(body\.id===['"]earth['"]&&this\.geodesicEarthRenderer&&this\.earthRenderMode!==['"]uv['"]\)/.test(planetLoop) || !/(?:pendingRenderer|activeRenderer)\.render\(frame\)/.test(planetLoop)) throw new Error('Geodesic rendering must be restricted to Earth and use the existing frame data.');
     if(!/if\(!renderedGeodesicEarth\)\s*\{[\s\S]*?g\.disable\(g\.CULL_FACE\);[\s\S]*?g\.depthMask\(true\);[\s\S]*?g\.bindTexture\(g\.TEXTURE_2D_ARRAY,null\);[\s\S]*?g\.useProgram\(this\.bodyProgram\);\s*this\.bindMesh\(mesh,l\);\s*g\.drawElements\(g\.TRIANGLES,mesh\.count,g\.UNSIGNED_SHORT,0\);\s*\}/.test(planetLoop)) throw new Error('UV fallback must restore WebGL state, run only when geodesic rendering did not draw, and bind its mesh.');
    const atmosphereBlock=extractBlock(' drawAtmosphere(body,profile,p,radius,mesh,vp,eye,light,occluders){');
    const cloudsBlock=extractBlock(' drawClouds(body,layers,p,radius,mesh,vp,light,occluders,timeSeconds,baseModel){');
    if(!atmosphereBlock.includes('g.useProgram(this.atmosphereProgram)')||!/this\.bindMesh\(mesh,l\);\s*g\.drawElements\(/.test(atmosphereBlock)) throw new Error('Atmosphere pass must bind its own program and mesh before drawing.');
    if(!cloudsBlock.includes('g.useProgram(this.cloudProgram)')||!/this\.bindMesh\(mesh,l\);\s*g\.drawElements\(/.test(cloudsBlock)) throw new Error('Cloud pass must bind its own program and mesh before drawing.');
    const rings=await readFile(new URL('../src/rendering/rings/ring-renderer.ts',import.meta.url),'utf8');
    if(!rings.includes('g.useProgram(this.program)')||!rings.includes('g.drawArrays(g.TRIANGLE_STRIP,0,this.count)')) throw new Error('Ring pass must bind its independent program before drawing.');
    if(!/for\(const body of bodies\)\{\s*g\.useProgram\(this\.bodyProgram\);/.test(source)) throw new Error('Adjacent planet iterations must reset the surface program to prevent WebGL state leakage.');
    if (!surface.includes('if(uKind>5.5&&uKind<6.5)') || !surface.includes('float cloudBands=fbm3(domainWarp3(n*vec3(7.0,24.0,7.0)') || !surface.includes('if(uColor.g>uColor.b*0.85)') || !source.includes('venus:5') || !source.includes('sun:6,mercury:2') || source.includes('g.uniform1f(l.uKind,7);')) throw new Error('The solar-system-only scene must not retain a spacecraft emissive material path.');
    if (!surface.includes('pow(uColor,vec3(2.2))')) throw new Error('Base material colors must be converted from sRGB to linear light.');
    if (!surface.includes('fbm3Filtered') || !surface.includes('fwidth(p.x)')) throw new Error('Procedural surface detail must filter sub-pixel noise octaves.');
    if (!source.includes('this.lighting.sampleAt(p,\'sun\')')) throw new Error('Renderer must use the lighting engine.');
    if (!source.includes('drawAtmosphere(') || !source.includes('drawClouds(') || !source.includes('collectOccluders(') || !source.includes('calculateEclipse(') || !source.includes('this.graphics.atmosphere&&profile') || !source.includes('this.graphics.clouds&&cloudLayers.length') || !source.includes('this.graphics.shadows?1:0') || !source.includes('this.drawAtmosphere(body,profile,p,radius,mesh,vp,eye,light,occluders)')) throw new Error('Atmosphere, cloud and analytic shadow effects must be independent and respect their toggles.');
    const atmosphereShader = await readFile(new URL('../src/rendering/shaders/planet-effects.ts', import.meta.url), 'utf8');
    if (!atmosphereShader.includes('for(int i=0;i<16;i++)') || !atmosphereShader.includes('rayleighDepth') || !atmosphereShader.includes('fbm(p)') || !atmosphereShader.includes('visibilitySum+=localShadowVisibility(samplePosition)') || !atmosphereShader.includes('float lighting=diffuse*localShadowVisibility(vPosition)') || !atmosphereShader.includes('(0.015+0.985*day)')) throw new Error('Planet materials must use view-ray atmospheric integration and procedural cloud density.');
    if (!atmosphereShader.includes('fbmFiltered') || !atmosphereShader.includes('fwidth(p.x)')) throw new Error('Procedural cloud detail must suppress sub-pixel noise octaves.');
    if (!source.includes('this.hdr.setOpticalSource(') || !hdr.includes('uGlareEnabled') || !hdr.includes('uLensFlareEnabled')) throw new Error('Glare and lens flare must be part of the final GPU composite.');
    const quality = await readFile(new URL('../src/rendering/quality/quality-settings.ts', import.meta.url), 'utf8');
    if (!quality.includes('renderScale') || !quality.includes('bloomIterations') || !quality.includes('shadowOccluders') || !source.includes('this.graphics?.renderScale') || !source.includes('this.graphics.maxMeshLod')) throw new Error('Quality presets must control actual render resolution and GPU effect quality.');
    if (!quality.includes('msaaSamples:0') || !quality.includes('msaaSamples:2') || quality.includes('msaaSamples:4') || !source.includes('this.hdr.setMultisampleSamples(Math.min(2,settings.msaaSamples))')) throw new Error('MSAA must remain within the two-sample GTX 1650 safety ceiling.');
    const lighting = await readFile(new URL('../src/presentation/lighting-engine.ts', import.meta.url), 'utf8');
    if (!lighting.includes('export class LightingEngine') || !lighting.includes('setPointLight') || !lighting.includes('sampleAt(point, id)') || !lighting.includes('getLights()') || !lighting.includes('Math.max(1e-12, dx * dx + dy * dy + dz * dz)') || !source.includes("import { LightingSystem, focusedSolarExposureMultiplier, planetaryDisplayGain } from '../rendering/lighting/lighting-system.ts'") || !source.includes('this.lighting=new LightingSystem()') || !source.includes("this.lighting.addSource({id:'sun',kind:'point'") || !source.includes('setStellarSource(id:string,positionSI:[number,number,number]') || !source.includes('for(const [id,source] of this.stellarSourceDefinitions)')) throw new Error('Lighting engine is missing inverse-square point-light sampling or multi-light enumeration.');
    if (!surface.includes('vec3(1.0,0.53,0.16)') || !surface.includes('vec3(0.003,0.012,0.045)') || !surface.includes('vec3(0.018,0.14,0.31)') || !surface.includes('vec3(0.025,0.105,0.035)') || !surface.includes('vec3(0.16,0.34,0.105)')) throw new Error('Star emissive color or the current Earth ocean and land palette is incomplete.');
    if (!source.includes('opacity*=planetaryOrbitOpacity(bodyDistance,body.meanRadiusM/AU)') || !source.includes('this.drawOrbit(world,body,states,sun,vp,mapper,1,eye,h,bodyDistance,renderOrigin)') || source.includes('planetOrbitFade') || source.includes('localMode')) throw new Error('Each orbit must share its own body label distance curve in the common scene.');
    const orbitLod = await readFile(new URL('../src/rendering/quality/render-lod.ts', import.meta.url), 'utf8');
    if (!source.includes('makeSphere(g,128,192)') || !source.includes('selectMeshLod(px,this.graphics.maxMeshLod)') || !source.includes('Math.log2(Math.max(1,px)/18)') || !source.includes('Math.min(1024') || !source.includes('smoothVisibility') || !source.includes('orbitSegmentCounts') || !source.includes('orbitVisibilityStates') || !source.includes('cached.path!==path') || !source.includes('uModel') || source.includes('bufferSubData') || source.includes('projectedOrbitRadius(body.orbitalElements.semiMajorAxisM/AU,viewportHeight,parentDistance)<0.12') || !source.includes('opacity*=planetaryOrbitOpacity(bodyDistance,body.meanRadiusM/AU)') || !orbitLod.includes('(ratio-120)/(2400-120)') || !orbitLod.includes('projectedOrbitRadius')) throw new Error('High-detail sphere LOD or stable adaptive orbit rendering is missing.');
    if (!source.includes('opacity*=planetaryOrbitOpacity(bodyDistance,body.meanRadiusM/AU)') || !source.includes('g.enable(g.BLEND)') || !source.includes('g.depthMask(false)')) throw new Error('Planetary and satellite orbit fading must share distance opacity and alpha blending.');
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
  ['Geodesic graphics presets budget twenty pages and throttle per-frame uploads', async () => {
    const quality=await readFile(new URL('../src/rendering/quality/quality-settings.ts',import.meta.url),'utf8');
    const renderer=await readFile(new URL('../src/rendering/geodesic/geodesic-planet-renderer.ts',import.meta.url),'utf8');
    const solar=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
    const workers=await readFile(new URL('../src/rendering/geodesic/surface-worker-pool.ts',import.meta.url),'utf8');
    for(const level of ['low','medium','high','ultra']){
      if(!quality.includes(level+':{pageResolution:')||!quality.includes('geodesic:GEODESIC_QUALITY_PRESETS.'+level))throw new Error('Missing geodesic quality profile: '+level);
    }
    if(!renderer.includes('gpuOperationsThisFrame<this.maxUploadsPerFrame')||!renderer.includes('this.gpuBudgetBytes')||!renderer.includes('this.cpuBudgetBytes')||!renderer.includes('this.gpu.initializeStep()')||!renderer.includes('this.manager.requestMesh('))throw new Error('Geodesic mesh generation, incremental texture allocation and GPU uploads must be explicitly bounded.');
    if(!solar.includes('this.rebuildGeodesicRenderer(this.graphics)')||!solar.includes("window.dispatchEvent(new CustomEvent('graphics-diagnostics'"))throw new Error('Preset changes must rebuild one renderer and publish live diagnostics.');
    if(!renderer.includes('MAX_VERTEX_TEXTURE_IMAGE_UNITS')||!renderer.includes('MAX_TEXTURE_IMAGE_UNITS')||!renderer.includes('MAX_ARRAY_TEXTURE_LAYERS')||!renderer.includes('MAX_TEXTURE_SIZE'))throw new Error('Geodesic renderer must validate the WebGL2 limits it depends on.');
    const meshWorker=await readFile(new URL('../src/rendering/geodesic/surface-tile-worker.ts',import.meta.url),'utf8');
    const pool=await readFile(new URL('../src/rendering/geodesic/surface-worker-pool.ts',import.meta.url),'utf8');
    const meshSource=await readFile(new URL('../src/rendering/geodesic/tile-mesh.ts',import.meta.url),'utf8');
    const gpuCache=await readFile(new URL('../src/rendering/geodesic/virtual-surface-manager.ts',import.meta.url),'utf8');
    if(renderer.includes('buildGeodesicTileMesh(tile,this.meshResolution')||!renderer.includes('this.manager.requestMesh(')||!meshWorker.includes("kind:'mesh'")||!meshWorker.includes('build_geodesic_tile_mesh(')||!meshWorker.includes('transferables(arrays)')||!meshWorker.includes('await ensureWasm()')||!pool.includes('maxPendingTasks')||!pool.includes('Math.min(2,Math.floor(options.maxPendingTasks??2))')||!pool.includes('Math.min(1,Math.max(1,cores-2),requested)'))throw new Error('CPU mesh generation must use the bounded shared worker pool and transferable arrays.');
    if(!solar.includes('requestAnimationFrame(()=>requestAnimationFrame(')||!gpuCache.includes('initializeStep():boolean')||!meshSource.includes('resolution>64'))throw new Error('Geodesic initialization must be deferred, GPU arrays incremental, and stitching-compatible.');
    if(!solar.includes('readonly ready:Promise<void>')||!solar.includes('private async initialize():Promise<void>')||!solar.includes('await this.yieldToBrowser()')||!solar.includes('1920*1080')||!solar.includes('antialias:false')||!solar.includes('PerformanceObserver')||!solar.includes('longestSynchronousChunkMs')||!solar.includes('longestLongTaskMs'))throw new Error('Base WebGL initialization must yield between stages, expose optional Long Task diagnostics, and enforce a conservative render-pixel budget.');
    const qualitySettings=await readFile(new URL('../src/rendering/quality/quality-settings.ts',import.meta.url),'utf8');
    if(!qualitySettings.includes('ultra:{pageResolution:160,meshResolution:64')||qualitySettings.includes('meshResolution:96'))throw new Error('Every graphics preset must stay within the stitcher resolution contract.');
    if(planetaryLabelOpacity(1000,10)!==planetaryOrbitOpacity(1000,10)||!solar.includes('node.style.opacity=String(labelOpacity)')||solar.includes('projectedFade'))throw new Error('Planet labels and orbit lines must share one smooth fade without a projected-radius cutoff.');
    if(!renderer.includes('private failRenderer(error:unknown,taskKind=')||!renderer.includes('firstFailureValue')||!renderer.includes('failureTaskKindValue')||!renderer.includes('this.lastPinnedPages=pinned.length')||!renderer.includes('scheduleWorkerTasks()')||!workers.includes('rejectQueuedWithoutWorkers')||!workers.includes("reply?.type==='ready'")||workers.includes('this.spawn();this.pump()'))throw new Error('Geodesic failures must preserve the first task error, throttle startup work and avoid worker respawn loops.');
  }],
  ['Rendering uses non-mutating fractional snapshots', async () => {
    const physics = await readFile(new URL('../src/physics/physics-world.ts', import.meta.url), 'utf8');
    const lab = await readFile(new URL('../lab/lab.ts', import.meta.url), 'utf8');
    if (!physics.includes('getBodyStatesAt(') || !physics.includes('getVesselStateAt(')) throw new Error('Fractional state snapshot APIs are missing.');
    if (!lab.includes('getBodyStatesAt(renderTime)') || !lab.includes("getVesselStateAt('test-vessel',renderTime,renderedBodyStates)")) throw new Error('Renderer is not using synchronized snapshots.');
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