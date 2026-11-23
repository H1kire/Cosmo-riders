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
      for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
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
    if (!source.includes("getContext('webgl2'") || !source.includes('makeSphere(g,44,60)')) throw new Error('WebGL2 renderer or high-detail sphere mesh is missing.');
    if (!source.includes('new HDRPipeline(') || !source.includes('this.hdr.begin(renderWidth,renderHeight)') || !source.includes('this.hdr.present(w,h)')) throw new Error('Solar scene must render through the HDR scene target and final post-process pass.');
    const hdr = await readFile(new URL('../src/rendering/core/hdr-pipeline.ts', import.meta.url), 'utf8');
    if (!hdr.includes('EXT_color_buffer_float') || !hdr.includes('RGBA16F') || !hdr.includes('HALF_FLOAT')) throw new Error('HDR pipeline must allocate floating-point RGBA16F render targets when supported.');
    if (!hdr.includes('const BRIGHT') || !hdr.includes('const BLUR') || !hdr.includes('const COMPOSITE') || !hdr.includes('uBloomStrength') || !hdr.includes('aces(')) throw new Error('HDR pipeline must execute bright extraction, blur and tone-mapped composite passes.');
    if (!source.includes('mapPosition(p){return[p.x/AU,p.z/AU,p.y/AU];}') || !source.includes('const renderOrigin=focusState?focusState.position:sun;') || !source.includes('x:p.x-renderOrigin.x,y:p.y-renderOrigin.y,z:p.z-renderOrigin.z') || !source.includes('this.target=this.focusOffset.slice();') || !source.includes('radius=body.meanRadiusM/AU')) throw new Error('Solar renderer must use true AU distances and physical radii with a high-precision camera-relative origin.');
    if (!source.includes('Math.max(radius,viewDistance)')) throw new Error('Projected LOD radius must use physical camera distance without a fixed-distance clamp.');
    if (!source.includes('far=100,near=Math.max(1e-10,this.distance*.001)')) throw new Error('Focused planetary views must retain the full 100 AU scene range while keeping the near plane proportional to camera distance.');
    if (source.includes('r=.045') || !source.includes('shipDistance*8*Math.tan(Math.PI/6)/h')) throw new Error('Vessel marker must use a camera-distance-scaled screen-space radius, never a fixed AU-sized sphere.');
    if (!source.includes('sunStrength=clamp(uLightIntensity,0.0,1.0)') || !source.includes('l=.12+.88*sunStrength*sunFacing*visibility')) throw new Error('Planetary shading must retain ambient visibility on night sides and clamp direct illumination.');
    if (!source.includes('if(uKind>5.5){gl_FragColor=vec4(pow(uColor,vec3(2.2))*2.8,1.0);return;}') || !source.includes('sun:6,mercury:2') || !source.includes('g.uniform1f(l.uKind,5);')) throw new Error('Only the star may use the emissive material path; the vessel must remain non-emissive.');
    if (!source.includes('vec3 c=pow(uColor,vec3(2.2));')) throw new Error('Material colors must be linearized before HDR lighting and tone mapping.');
    if (!source.includes('this.lighting.sampleAt(p,\'sun\')')) throw new Error('Renderer must use the lighting engine.');
    if (!source.includes('drawAtmosphere(') || !source.includes('drawClouds(') || !source.includes('collectOccluders(') || !source.includes('calculateEclipse(') || !source.includes('this.graphics.shadows?this.getCenterShadowVisibility')) throw new Error('Atmosphere, cloud and analytic shadow effects must be connected to the solar renderer and respect their toggles.');
    const atmosphereShader = await readFile(new URL('../src/rendering/shaders/planet-effects.ts', import.meta.url), 'utf8');
    if (!atmosphereShader.includes('for(int i=0;i<16;i++)') || !atmosphereShader.includes('rayleighDepth') || !atmosphereShader.includes('fbm(p)')) throw new Error('Planet materials must use view-ray atmospheric integration and procedural cloud density.');
    if (!source.includes('this.hdr.setOpticalSource(') || !hdr.includes('uGlareEnabled') || !hdr.includes('uLensFlareEnabled')) throw new Error('Glare and lens flare must be part of the final GPU composite.');
    const quality = await readFile(new URL('../src/rendering/quality/quality-settings.ts', import.meta.url), 'utf8');
    if (!quality.includes('renderScale') || !quality.includes('bloomIterations') || !quality.includes('shadowOccluders') || !source.includes('this.graphics?.renderScale') || !source.includes('this.graphics.maxMeshLod')) throw new Error('Quality presets must control actual render resolution and GPU effect quality.');
    const lighting = await readFile(new URL('../src/presentation/lighting-engine.ts', import.meta.url), 'utf8');
    if (!lighting.includes('export class LightingEngine') || !lighting.includes('setPointLight') || !lighting.includes('sampleAt(point, id)')) throw new Error('Lighting engine is missing the renderer sampleAt API.');
    if (!source.includes('uColor*(1.15+b*.12)') || source.includes('uColor*(1.15+fine*.12)')) throw new Error('Sun fragment shader contains an invalid or unresolved variable.');
    if (!source.includes('for(const body of bodies)this.drawOrbit(world,body,states,sun,vp,mapper)') || source.includes('localMode')) throw new Error('All solar-system orbits must remain in one shared scene without local-scene filtering.');
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