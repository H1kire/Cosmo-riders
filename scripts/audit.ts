import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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
        const candidates = /\.[cm]?tsx?$/.test(target) ? [target] : [target + '.ts', target + '.tsx', join(target, 'index.ts')];
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
    if (!source.includes('mapPosition(p):[number,number,number]{return[p.x/AU,p.z/AU,p.y/AU];}') || !source.includes('const renderOrigin=focusState?focusState.position:sun;') || !source.includes('x:p.x-renderOrigin.x,y:p.y-renderOrigin.y,z:p.z-renderOrigin.z') || !source.includes('this.target=this.focusOffset.slice();') || !source.includes('radius=body.meanRadiusM/AU')) throw new Error('Solar renderer must use true AU distances and physical radii with a high-precision camera-relative origin.');
    if (!source.includes('Math.max(radius,viewDistance)')) throw new Error('Projected LOD radius must use physical camera distance without a fixed-distance clamp.');
    if (!source.includes('TEXTURE_DETAIL_CAPS={low:.65,medium:.95,high:1.25,ultra:1.5}') || !source.includes('this.graphics.textureQuality')) throw new Error('Texture quality preset must control procedural surface detail.');
    if (!source.includes('far=100,near=Math.max(1e-10,this.distance*.001)')) throw new Error('Focused planetary views must retain the full 100 AU scene range while keeping the near plane proportional to camera distance.');
    if (source.includes('r=.045') || !source.includes('shipDistance*8*Math.tan(Math.PI/6)/h')) throw new Error('Vessel marker must use a camera-distance-scaled screen-space radius, never a fixed AU-sized sphere.');
    const surface = await readFile(new URL('../src/rendering/shaders/planet-surface.ts', import.meta.url), 'utf8');
    if (!surface.includes('uLightPositions[4]') || !surface.includes('uLightIntensities[i]/(22.0*distanceSquared)') || !surface.includes('distributionGGX') || !surface.includes('geometrySchlick') || !surface.includes('surfaceAlbedo')) throw new Error('Planetary materials must use inverse-square multi-light shading, microfacet specular and distinct surface maps.');
    if (!surface.includes('vec3 indirect=albedo*0.0001') || !surface.includes('uSunRadius*along/max(sunDistance-along,1e-12)')) throw new Error('Planetary night-side floor or stellar angular penumbra is not physically bounded.');
    if (!/for\(const body of bodies\)\{\s*g\.useProgram\(this\.bodyProgram\);\s*const state=states\.get\(body\.id\);/.test(source) || !/this\.bindMesh\(mesh,l\);g\.drawElements\(g\.TRIANGLES,mesh\.count,g\.UNSIGNED_SHORT,0\);\s*const profile=this\.atmosphereSystem/.test(source)) throw new Error('Surface shader must be rebound before every planet after atmosphere/cloud passes.');
    if (!surface.includes('if(uKind>5.5&&uKind<6.5)') || !surface.includes('float cloudBands=fbm3(n*vec3(7.0,24.0,7.0)') || !surface.includes('if(uColor.g>uColor.b*0.85)') || !source.includes('venus:5') || !source.includes('sun:6,mercury:2') || !source.includes('g.uniform1f(l.uKind,7);')) throw new Error('Only the star may use the emissive material path; the vessel must remain non-emissive.');
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
    if (!quality.includes('msaaSamples:0') || !quality.includes('msaaSamples:2') || !quality.includes('msaaSamples:4') || !source.includes('this.hdr.setMultisampleSamples(settings.msaaSamples)')) throw new Error('MSAA sample count must follow the selected graphics preset.');
    const lighting = await readFile(new URL('../src/presentation/lighting-engine.ts', import.meta.url), 'utf8');
    if (!lighting.includes('export class LightingEngine') || !lighting.includes('setPointLight') || !lighting.includes('sampleAt(point, id)') || !lighting.includes('getLights()') || !lighting.includes('Math.max(1e-12, dx * dx + dy * dy + dz * dz)') || !source.includes("import { LightingSystem } from '../rendering/lighting/lighting-system.ts'") || !source.includes('this.lighting=new LightingSystem()') || !source.includes("this.lighting.addSource({id:'sun',kind:'point'") || !source.includes('setStellarSource(id:string,positionSI:[number,number,number]') || !source.includes('for(const [id,source] of this.stellarSourceDefinitions)')) throw new Error('Lighting engine is missing inverse-square point-light sampling or multi-light enumeration.');
    if (!surface.includes('vec3(1.0,0.53,0.16)') || !surface.includes('vec3(0.006,0.022,0.075)') || !surface.includes('vec3(0.014,0.105,0.245)') || !surface.includes('vec3(0.035,0.095,0.028)') || !surface.includes('vec3(0.17,0.27,0.082)')) throw new Error('Star emissive color or the current Earth ocean and land palette is incomplete.');
    if (!source.includes("for(const body of bodies)this.drawOrbit(world,body,states,sun,vp,mapper,body.parentId==='sun'?planetOrbitFade:1,eye,h)") || source.includes('localMode')) throw new Error('All solar-system orbits must remain in one shared scene without local-scene filtering.');
    const orbitLod = await readFile(new URL('../src/rendering/quality/render-lod.ts', import.meta.url), 'utf8');
    if (!source.includes('makeSphere(g,128,192)') || !source.includes('selectMeshLod(px,this.graphics.maxMeshLod)') || !source.includes('Math.log2(Math.max(1,px)/18)') || !source.includes('segments=Math.max(512') || !source.includes('planetaryOrbitOpacity(orbitCameraDistance,orbitAnchor.meanRadiusM/AU)') || !orbitLod.includes('ratio-120') || !orbitLod.includes('ratio-2400') || !orbitLod.includes('projectedOrbitRadius') || !source.includes('projectedOrbitRadius(body.orbitalElements.semiMajorAxisM/AU,viewportHeight,parentDistance)<0.8')) throw new Error('High-detail sphere LOD or smooth heliocentric orbit fade is missing.');
    if (!source.includes('body.parentId===\'sun\'?planetOrbitFade:1') || !source.includes('g.enable(g.BLEND)') || !source.includes('g.depthMask(false)')) throw new Error('Planetary orbit fading must preserve satellite orbit visibility and alpha blending.');
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