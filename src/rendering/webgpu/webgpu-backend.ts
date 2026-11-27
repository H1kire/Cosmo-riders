import type { SurfaceProfile } from '../geodesic/surface-tile.ts';
import { WebGPUGeodesicSurfaceSystem, type WebGPUGeodesicSurfaceSettings } from './webgpu-geodesic-surface-system.ts';

/**
 * First native WebGPU sphere renderer.
 *
 * This module owns only WebGPU resources. Scene state, camera matrices and
 * body transforms are supplied by Solar3DView so physics remains single-source.
 * It intentionally does not wrap or call WebGL.
 */
export interface SphereGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
}

export interface WebGPUBodyDraw {
  id: string;
  model: ArrayLike<number>;
  position: readonly [number, number, number];
  color: readonly [number, number, number];
  star: boolean;
  kind: number;
  seed: number;
  waterFraction: number;
  iceFraction: number;
  ironFraction?: number;
  tectonicActivity?: number;
  volcanicActivity?: number;
  erosion?: number;
  detail?: number;
  lod: number;
  eclipseVisibility?: number;
  shadowOccluders?: Float32Array;
  shadowsEnabled?: boolean;
  surfaceProfile?: SurfaceProfile;
  atmosphere?: { color: readonly [number, number, number]; intensity: number; thicknessRatio: number; mie: number; anisotropy: number; };
  clouds?: readonly { altitudeRatio: number; coverage: number; opacity: number; scale: number; wind: readonly [number, number]; }[];
}

export interface WebGPUOrbitDraw { id: string; model: ArrayLike<number>; points: Float32Array; color: readonly [number, number, number]; opacity: number; }
export interface WebGPURingDraw { id: string; model: ArrayLike<number>; }

export interface WebGPUFrame {
  viewProjection: ArrayLike<number>;
  cameraPosition: ArrayLike<number>;
  cameraForward?: ArrayLike<number>;
  verticalFovRadians?: number;
  viewportWidthPx?: number;
  viewportHeightPx?: number;
  timeSeconds: number;
  bodies: readonly WebGPUBodyDraw[];
  orbits: readonly WebGPUOrbitDraw[];
  rings: readonly WebGPURingDraw[];
  sunPosition: readonly [number, number, number];
  sunRadius?: number;
  sunUv?: readonly [number, number];
  sunVisible?: boolean;
  geodesicSettings?: WebGPUGeodesicSurfaceSettings;
  postProcessing?: { bloom?: boolean; bloomThreshold?: number; bloomStrength?: number; bloomIterations?: number; exposure?: number; hdr?: boolean; toneMapping?: 'reinhard' | 'aces'; glare?: boolean; glareStrength?: number; lensFlare?: boolean; lensFlareStrength?: number; };
}

interface BodyGpuResources { uniform: any; bindGroup: any; }
interface MeshGpuResources { positions: any; normals: any; indices: any; indexCount: number; }
interface OrbitGpuResources { vertex: any; uniform: any; bindGroup: any; capacity: number; points: Float32Array | null; count: number; }
interface RingGpuResources { uniform: any; bindGroup: any; }

const ZERO_SHADOW_OCCLUDERS = new Float32Array(32);
const BUFFER_USAGE = { COPY_DST: 0x0008, INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040 };
const TEXTURE_USAGE = { TEXTURE_BINDING: 0x0004, RENDER_ATTACHMENT: 0x0010 };
const POST_SHADER = `
struct U { params: vec4<f32>, optical: vec4<f32>, controls: vec4<f32>, };
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: U;
@group(0) @binding(3) var bloom: texture_2d<f32>;
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, };
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
 var p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
 var o:V; let q=p[i]; o.pos=vec4<f32>(q,0.0,1.0); o.uv=vec2<f32>((q.x+1.0)*0.5,1.0-(q.y+1.0)*0.5); return o;
}
@fragment fn bright(v:V)->@location(0) vec4<f32>{
 let c=textureSample(src,samp,v.uv).rgb; let l=max(max(c.r,c.g),c.b);
 return vec4<f32>(c*(max(l-u.params.x,0.0)/max(l,0.0001)),1.0);
}
@fragment fn blur(v:V)->@location(0) vec4<f32>{
 let d=u.params.yz; var c=textureSample(src,samp,v.uv).rgb*0.227027;
 c+=textureSample(src,samp,v.uv+d*1.384615).rgb*0.316216;
 c+=textureSample(src,samp,v.uv-d*1.384615).rgb*0.316216;
 c+=textureSample(src,samp,v.uv+d*3.230769).rgb*0.070270;
 c+=textureSample(src,samp,v.uv-d*3.230769).rgb*0.070270;
 return vec4<f32>(c,1.0);
}
fn aces(x:vec3<f32>)->vec3<f32>{return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),vec3<f32>(0.0),vec3<f32>(1.0));}
fn halo(p:vec2<f32>,c:vec2<f32>,k:f32)->f32{let d=p-c;return exp(-dot(d,d)*k);}
@fragment fn composite(v:V)->@location(0) vec4<f32>{
 var h=textureSample(src,samp,v.uv).rgb+textureSample(bloom,samp,v.uv).rgb*u.optical.x;
 let sun=u.optical.yz; let visible=u.optical.w; let d=v.uv-sun; let r=length(d);
 if(visible>0.0 && u.controls.z>0.0){
  let a=atan2(d.y,d.x); let rays=pow(abs(cos(a*4.0)),32.0)*exp(-r*48.0);
  let streak=(exp(-abs(d.x)*900.0)+exp(-abs(d.y)*900.0))*exp(-r*34.0);
  h+=vec3<f32>(1.0,0.79,0.53)*(rays*0.16+streak*0.035+halo(v.uv,sun,10500.0)*0.18)*u.controls.z*visible;
 }
 if(visible>0.0 && u.controls.w>0.0){
  let axis=vec2<f32>(0.5)-sun;
  let ghosts=halo(v.uv,sun+axis*0.48,2600.0)*0.18+halo(v.uv,sun+axis*0.92,4200.0)*0.12+halo(v.uv,sun-axis*0.32,6500.0)*0.08;
  let streak2=exp(-abs(v.uv.y-sun.y)*1800.0)*exp(-abs(v.uv.x-sun.x)*28.0);
  h+=vec3<f32>(0.48,0.68,1.0)*(ghosts+streak2*0.035)*u.controls.w*visible;
 }
 h*=max(0.0,u.params.w);
 var mapped=h;
 if(u.controls.x<0.5){mapped=clamp(h,vec3<f32>(0.0),vec3<f32>(1.0));}
 else if(u.controls.y>0.5){mapped=aces(h);}
 else{mapped=h/(vec3<f32>(1.0)+h);}
 return vec4<f32>(pow(max(mapped,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);
}
`;

export function createSphereGeometry(latitudeSegments: number, longitudeSegments: number): SphereGeometryData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= latitudeSegments; y++) {
    const phi = y / latitudeSegments * Math.PI;
    for (let x = 0; x <= longitudeSegments; x++) {
      const theta = x / longitudeSegments * Math.PI * 2;
      const p: [number, number, number] = [
        -Math.cos(theta) * Math.sin(phi),
        Math.cos(phi),
        Math.sin(theta) * Math.sin(phi)
      ];
      positions.push(...p);
      normals.push(...p);
    }
  }
  for (let y = 0; y < latitudeSegments; y++) {
    for (let x = 0; x < longitudeSegments; x++) {
      const a = y * (longitudeSegments + 1) + x;
      const b = a + longitudeSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices)
  };
}

const RING_SHADER = `
struct RingUniforms { viewProjection: mat4x4<f32>, model: mat4x4<f32>, color: vec4<f32>, params: vec4<f32>, };
@group(0) @binding(0) var<uniform> ring: RingUniforms;
struct VertexInput { @location(0) position: vec3<f32>, };
struct VertexOutput { @builtin(position) clipPosition: vec4<f32>, @location(0) localPosition: vec3<f32>, };
@vertex fn vertexMain(input: VertexInput) -> VertexOutput { var output: VertexOutput; output.localPosition=input.position; output.clipPosition=ring.viewProjection*ring.model*vec4<f32>(input.position,1.0); return output; }
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
 let radius=length(input.localPosition.xz);
 let edge=smoothstep(ring.params.x,ring.params.x+0.012,radius)*(1.0-smoothstep(0.985,1.0,radius));
 let bands=0.72+0.16*sin(radius*410.0)+0.08*sin(radius*1270.0)+0.04*sin(radius*2830.0);
 let division=1.0-0.82*smoothstep(0.003,0.012,abs(radius-0.78));
 let alpha=ring.params.y*edge*bands*division;
 if(alpha<0.012){discard;}
 return vec4<f32>(ring.color.rgb*(0.62+0.38*bands),alpha);
}
`;

const ORBIT_SHADER = `
struct OrbitUniforms { viewProjection: mat4x4<f32>, model: mat4x4<f32>, color: vec4<f32>, };
@group(0) @binding(0) var<uniform> orbit: OrbitUniforms;
struct VertexInput { @location(0) position: vec3<f32>, };
@vertex fn vertexMain(input: VertexInput) -> @builtin(position) vec4<f32> { return orbit.viewProjection * orbit.model * vec4<f32>(input.position, 1.0); }
@fragment fn fragmentMain() -> @location(0) vec4<f32> { return orbit.color; }
`;

const SHADER = `
struct BodyUniforms {
  model: mat4x4<f32>,
  viewProjection: mat4x4<f32>,
  color: vec4<f32>,
  lightAndEmission: vec4<f32>,
  material: vec4<f32>,
  surfaceParams: vec4<f32>,
  cameraPosition: vec4<f32>,
  lighting: vec4<f32>,
  sunPosition: vec4<f32>,
  shadowOccluders: array<vec4<f32>, 8>,
};

@group(0) @binding(0) var<uniform> body: BodyUniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) lightDirection: vec3<f32>,
  @location(2) localDirection: vec3<f32>,
  @location(3) worldPosition: vec3<f32>,
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  var displacedPosition = input.position;
  let kind = body.material.x;
  if (body.lightAndEmission.w < 0.5 && !(kind > 2.5 && kind < 4.5)) {
    let detailScale = max(0.35, body.lighting.w);
    let broadRelief = noise3(input.position * (8.0 * detailScale));
    let fineRelief = noise3(input.position * (27.0 * detailScale));
    var reliefScale = 0.0016;
    if (kind > 7.5 && kind < 8.5) { reliefScale = 0.0040; }
    else if (kind > 6.5 && kind < 7.5) { reliefScale = 0.0024; }
    else if (kind > 4.5 && kind < 5.5) { reliefScale = 0.00055; }
    reliefScale *= 0.55 + clamp(body.surfaceParams.y, 0.0, 1.0) * 0.45;
    let elevation = (broadRelief - 0.5) * 0.7 + (fineRelief - 0.5) * 0.3;
    displacedPosition = input.position * (1.0 + elevation * reliefScale);
  }
  let world = body.model * vec4<f32>(displacedPosition, 1.0);
  output.clipPosition = body.viewProjection * world;
  output.worldNormal = normalize((body.model * vec4<f32>(input.normal, 0.0)).xyz);
  output.lightDirection = normalize(body.lightAndEmission.xyz);
  output.localDirection = input.normal;
  output.worldPosition = world.xyz;
  return output;
}

fn hash3(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7)) + body.material.y * 19.19) * 43758.5453);
}
fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (vec3<f32>(3.0) - 2.0 * f);
  let a = mix(hash3(i), hash3(i + vec3<f32>(1.0, 0.0, 0.0)), u.x);
  let b = mix(hash3(i + vec3<f32>(0.0, 1.0, 0.0)), hash3(i + vec3<f32>(1.0, 1.0, 0.0)), u.x);
  let c = mix(hash3(i + vec3<f32>(0.0, 0.0, 1.0)), hash3(i + vec3<f32>(1.0, 0.0, 1.0)), u.x);
  let d = mix(hash3(i + vec3<f32>(0.0, 1.0, 1.0)), hash3(i + vec3<f32>(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
fn fbm3(p: vec3<f32>) -> f32 {
  var q = p;
  var amplitude = 0.5;
  var value = 0.0;
  for (var octave = 0; octave < 5; octave = octave + 1) {
    value += amplitude * noise3(q);
    q = q * 2.03 + vec3<f32>(13.1, 7.7, 19.3);
    amplitude *= 0.5;
  }
  return value;
}

fn surfaceShadowVisibility(worldPosition: vec3<f32>) -> f32 {
  if (body.sunPosition.w < 0.5) { return 1.0; }
  let toSun = body.sunPosition.xyz - worldPosition;
  let sunDistance = length(toSun);
  if (sunDistance <= 0.000001) { return 1.0; }
  let lightDirection = toSun / sunDistance;
  var visibility = 1.0;
  for (var index = 0u; index < 8u; index = index + 1u) {
    let occluder = body.shadowOccluders[index];
    if (occluder.w <= 0.0) { continue; }
    let toOccluder = occluder.xyz - worldPosition;
    let alongRay = dot(toOccluder, lightDirection);
    if (alongRay <= 0.0 || alongRay >= sunDistance) { continue; }
    let perpendicular = length(toOccluder - lightDirection * alongRay);
    let angularSunRadius = body.lighting.z * alongRay / max(sunDistance - alongRay, 0.0000001);
    let penumbra = occluder.w + angularSunRadius;
    let umbra = max(0.0, occluder.w - angularSunRadius);
    visibility *= smoothstep(umbra, max(umbra + 0.0000001, penumbra), perpendicular);
    if (visibility < 0.001) { break; }
  }
  return visibility;
}
@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let direction = normalize(input.localDirection);
  if (body.material.x > 8.5) {
    let normal = normalize(input.worldNormal);
    let viewDirection = normalize(body.cameraPosition.xyz - input.worldPosition);
    let rim = pow(clamp(1.0 - abs(dot(normal, viewDirection)), 0.0, 1.0), 2.35);
    let shadowFactor = mix(1.0, min(body.lighting.x, surfaceShadowVisibility(input.worldPosition)), clamp(body.lighting.y, 0.0, 1.0));
    let daylight = 0.18 + 0.82 * max(dot(normal, normalize(input.lightDirection)), 0.0) * shadowFactor;
    if (body.material.x < 9.5) {
      let scattering = rim * body.material.y * daylight * (0.65 + body.material.z * 8.0);
      return vec4<f32>(body.color.rgb * (0.35 + scattering * 1.8), clamp(scattering, 0.0, 0.82));
    }
    let cloudDrift = vec3<f32>(body.cameraPosition.w * body.surfaceParams.x, 0.0, body.cameraPosition.w * body.surfaceParams.y);
    let cloudNoise = fbm3(direction * body.material.w + cloudDrift);
    let cloudMask = smoothstep(1.0 - body.material.y, 1.0 - body.material.y + 0.16, cloudNoise);
    let cloudAlpha = cloudMask * body.material.z * (0.22 + 0.78 * daylight);
    return vec4<f32>(body.color.rgb * (0.55 + 0.65 * daylight), clamp(cloudAlpha, 0.0, 0.95));
  }
  if (body.lightAndEmission.w > 0.5) {
    return vec4<f32>(body.color.rgb * 1.7, 1.0);
  }
  let tectonic = clamp(body.surfaceParams.y, 0.0, 1.0);
  let volcanic = clamp(body.surfaceParams.z, 0.0, 1.0);
  let iron = clamp(body.surfaceParams.x, 0.0, 1.0);
  let erosion = clamp(body.surfaceParams.w, 0.0, 1.0);
  let detailScale = max(0.35, body.lighting.w);
  let baseField = fbm3(direction * (4.2 * detailScale)) * 0.66 + fbm3(direction * (12.7 * detailScale)) * 0.34;
  let detail = mix(fbm3(direction * (31.0 * detailScale)), fbm3(direction * (13.0 * detailScale)), erosion * 0.58);
  let kind = body.material.x;
  var albedo = body.color.rgb;
  if (kind > 0.5 && kind < 1.5) {
    let ridgeNoise = 1.0 - abs(noise3(direction * ((18.0 + tectonic * 54.0) * detailScale)) * 2.0 - 1.0);
    let field = mix(baseField, max(baseField, ridgeNoise * 0.72), tectonic * 0.58);
    let land = smoothstep(0.455, 0.545, field);
    let ocean = vec3<f32>(0.012, 0.075, 0.22);
    let soilBase = mix(vec3<f32>(0.12, 0.19, 0.075), vec3<f32>(0.42, 0.32, 0.17), detail);
    let ironTint = vec3<f32>(0.18, 0.055, 0.018) * iron;
    let soil = clamp(soilBase + ironTint, vec3<f32>(0.0), vec3<f32>(1.0));
    albedo = mix(ocean, soil, land);
    let volcanicField = fbm3(direction * ((34.0 + volcanic * 76.0) * detailScale));
    let volcanicRock = smoothstep(0.76, 0.94, volcanicField) * volcanic;
    albedo = mix(albedo, vec3<f32>(0.16, 0.045, 0.025), volcanicRock * 0.62);
    let polar = smoothstep(0.78, 0.96, abs(direction.y)) * clamp(body.material.w * 4.0, 0.0, 1.0);
    albedo = mix(albedo, vec3<f32>(0.78, 0.86, 0.94), polar);
  } else if (kind > 6.5 && kind < 7.5) {
    let ridges = fbm3(direction * 22.0);
    albedo = mix(vec3<f32>(0.24, 0.065, 0.035), vec3<f32>(0.66, 0.25, 0.11), field * 0.7 + ridges * 0.3);
    let frost = smoothstep(0.84, 0.98, abs(direction.y));
    albedo = mix(albedo, vec3<f32>(0.72, 0.61, 0.49), frost * 0.55);
  } else if (kind > 7.5 && kind < 8.5) {
    let crater = smoothstep(0.43, 0.72, fbm3(direction * 38.0));
    albedo = body.color.rgb * (0.62 + detail * 0.32 - crater * 0.16);
  } else if (kind > 2.5 && kind < 3.5) {
    let bands = 0.5 + 0.5 * sin(direction.y * 58.0 + fbm3(direction * 8.0) * 5.0);
    albedo = mix(body.color.rgb * 0.58, body.color.rgb * 1.32, bands);
  } else if (kind > 3.5 && kind < 4.5) {
    let bands = 0.5 + 0.5 * sin(direction.y * 34.0 + fbm3(direction * 6.0) * 3.0);
    albedo = mix(body.color.rgb * 0.72, body.color.rgb * 1.18, bands);
  } else if (kind > 4.5 && kind < 5.5) {
    let haze = fbm3(direction * 18.0);
    albedo = mix(body.color.rgb * 0.72, body.color.rgb * 1.22, haze);
  } else {
    albedo *= 0.78 + detail * 0.42;
  }
  let diffuse = max(dot(normalize(input.worldNormal), normalize(input.lightDirection)), 0.0);
  let shadowFactor = mix(1.0, min(body.lighting.x, surfaceShadowVisibility(input.worldPosition)), clamp(body.lighting.y, 0.0, 1.0));
  let illumination = 0.10 + diffuse * 0.90 * shadowFactor;
  return vec4<f32>(albedo * illumination, 1.0);
}
`;

export class WebGPUBackend {
  readonly name = 'WebGPU';
  readonly canvas: HTMLCanvasElement;
  readonly ready: Promise<void>;
  adapter: any = null;
  device: any = null;
  context: any = null;
  format = '';
  state: 'initializing' | 'ready' | 'lost' | 'failed' | 'disposed' = 'initializing';
  error: string | null = null;
  initializationMs = 0;
  private pipeline: any = null;
  private effectPipeline: any = null;
  private depthTexture: any = null;
  private sceneTexture: any = null;
  private brightTexture: any = null;
  private pingTexture: any = null;
  private pongTexture: any = null;
  private postSampler: any = null;
  private postLayout: any = null;
  private postPipelines: any = {};
  private postUniforms: any[] = [];
  private postGroups: any[] = [];
  private readonly meshResources = new Map<number, MeshGpuResources>();
  private readonly bodyResources = new Map<string, BodyGpuResources>();
  private readonly orbitResources = new Map<string, OrbitGpuResources>();
  private readonly ringResources = new Map<string, RingGpuResources>();
  private ringPipeline: any = null;
  private ringBindGroupLayout: any = null;
  private ringVertexBuffer: any = null;
  private ringVertexCount = 0;
  private orbitPipeline: any = null;
  private orbitBindGroupLayout: any = null;
  private disposed = false;
  private recoveryAttempted = false;
  private geodesicSystem: WebGPUGeodesicSurfaceSystem | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    const started = performance.now();
    try {
      const gpu = (navigator as any).gpu;
      if (!gpu) throw new Error('navigator.gpu недоступен в этом браузере или origin.');
      // Chromium on Windows may ignore powerPreference; omit it to avoid a noisy no-op option.
      // A single default adapter request is deterministic and avoids retry loops.
      this.adapter = await gpu.requestAdapter();
      if (!this.adapter) throw new Error('WebGPU adapter недоступен.');
      const limits = this.adapter.limits ?? {};
      const maxBuffer = Number(limits.maxBufferSize ?? 0);
      if (maxBuffer > 0 && maxBuffer < 1024 * 1024) throw new Error('WebGPU adapter сообщает слишком малый maxBufferSize.');
      this.device = await this.adapter.requestDevice();
      this.device.addEventListener?.('uncapturederror', (event: any) => {
        const message = event?.error?.message || 'Uncaptured WebGPU validation error.';
        this.error = 'WebGPU validation error: ' + message;
        console.error('[Cosmo-riders][WebGPU]', this.error);
      });
      this.device.lost.then((info: any) => {
        if (this.disposed) return;
        this.state = 'lost';
        this.error = 'WebGPU device lost: ' + (info?.message || info?.reason || 'unknown reason');
        window.dispatchEvent(new CustomEvent('graphics-backend-lost', { detail: { backend: 'WebGPU', error: this.error } }));
      });
      this.context = this.canvas.getContext('webgpu') as any;
      if (!this.context) throw new Error('Не удалось получить GPUCanvasContext.');
      this.format = gpu.getPreferredCanvasFormat();
      this.configure();
      await this.createPipeline();
      this.createGeometryBuffers();
      this.state = 'ready';
      this.error = null;
    } catch (error) {
      this.state = 'failed';
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.initializationMs = performance.now() - started;
    }
  }

  private configure(): void {
    if (!this.device || !this.context) throw new Error('WebGPU device/context не готовы.');
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.min(1920, Math.round(rect.width * dpr)));
    const height = Math.max(1, Math.min(1080, Math.round(rect.height * dpr)));
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque'
    });
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({ size: [width, height, 1], format: 'depth24plus', usage: TEXTURE_USAGE.RENDER_ATTACHMENT });
    this.createPostTargets(width, height);
  }

  private async createPipeline(): Promise<void> {
    const module = this.device.createShaderModule({ code: SHADER });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter((message: any) => message.type === 'error');
    if (errors.length) throw new Error('WGSL compilation failed: ' + errors.map((item: any) => item.message).join('; '));
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: 3, buffer: { type: 'uniform', minBindingSize: 368 } }]
    });
    const layout = this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    this.pipeline = await this.device.createRenderPipelineAsync({
      layout,
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }
        ]
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba16float' }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    });
    this.effectPipeline = await this.device.createRenderPipelineAsync({
      layout,
      vertex: {
        module,
        entryPoint: 'vertexMain',
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }
        ]
      },
      fragment: {
        module,
        entryPoint: 'fragmentMain',
        targets: [{ format: 'rgba16float', blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
        } }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    });
    this.bindGroupLayout = bindGroupLayout;
    const orbitModule = this.device.createShaderModule({ code: ORBIT_SHADER });
    const orbitCompilation = await orbitModule.getCompilationInfo();
    const orbitErrors = orbitCompilation.messages.filter((message: any) => message.type === 'error');
    if (orbitErrors.length) throw new Error('WGSL orbit compilation failed: ' + orbitErrors.map((item: any) => item.message).join('; '));
    this.orbitBindGroupLayout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 3, buffer: { type: 'uniform', minBindingSize: 144 } }] });
    this.orbitPipeline = await this.device.createRenderPipelineAsync({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.orbitBindGroupLayout] }),
      vertex: { module: orbitModule, entryPoint: 'vertexMain', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module: orbitModule, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      primitive: { topology: 'line-strip' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    });
    const ringModule = this.device.createShaderModule({ code: RING_SHADER });
    const ringCompilation = await ringModule.getCompilationInfo();
    const ringErrors = ringCompilation.messages.filter((message: any) => message.type === 'error');
    if (ringErrors.length) throw new Error('WGSL ring compilation failed: ' + ringErrors.map((item: any) => item.message).join('; '));
    this.ringBindGroupLayout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 3, buffer: { type: 'uniform', minBindingSize: 160 } }] });
    this.ringPipeline = await this.device.createRenderPipelineAsync({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.ringBindGroupLayout] }),
      vertex: { module: ringModule, entryPoint: 'vertexMain', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module: ringModule, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float', blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      primitive: { topology: 'triangle-strip' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    });
    const ringSegments = 768, ringVertices = new Float32Array((ringSegments + 1) * 2 * 3);
    let ringOffset = 0;
    for (let index = 0; index <= ringSegments; index++) {
      const angle = index / ringSegments * Math.PI * 2, cosine = Math.cos(angle), sine = Math.sin(angle);
      ringVertices[ringOffset++] = cosine * 0.55; ringVertices[ringOffset++] = 0; ringVertices[ringOffset++] = sine * 0.55;
      ringVertices[ringOffset++] = cosine; ringVertices[ringOffset++] = 0; ringVertices[ringOffset++] = sine;
    }
    this.ringVertexBuffer = this.device.createBuffer({ size: ringVertices.byteLength, usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST });
    this.device.queue.writeBuffer(this.ringVertexBuffer, 0, ringVertices);
    this.ringVertexCount = ringVertices.length / 3;
    await this.createPostPipelines();
  }

  private createPostTargets(width:number,height:number):void {
    for(const texture of [this.sceneTexture,this.brightTexture,this.pingTexture,this.pongTexture]) texture?.destroy?.();
    const make=(w:number,h:number)=>this.device.createTexture({size:[w,h,1],format:'rgba16float',usage:TEXTURE_USAGE.RENDER_ATTACHMENT|TEXTURE_USAGE.TEXTURE_BINDING});
    this.sceneTexture=make(width,height);
    const bw=Math.max(1,Math.floor(width*0.5)),bh=Math.max(1,Math.floor(height*0.5));
    this.brightTexture=make(bw,bh);this.pingTexture=make(bw,bh);this.pongTexture=make(bw,bh);
    this.rebuildPostGroups();
  }

  private async createPostPipelines():Promise<void>{
    const module=this.device.createShaderModule({code:POST_SHADER});
    const info=await module.getCompilationInfo();const errors=info.messages.filter((m:any)=>m.type==='error');
    if(errors.length)throw new Error('WGSL post-processing compilation failed: '+errors.map((m:any)=>m.message).join('; '));
    this.postLayout=this.device.createBindGroupLayout({entries:[
      {binding:0,visibility:2,texture:{sampleType:'float'}},{binding:1,visibility:2,sampler:{type:'filtering'}},
      {binding:2,visibility:2,buffer:{type:'uniform',minBindingSize:48}},{binding:3,visibility:2,texture:{sampleType:'float'}}
    ]});
    const layout=this.device.createPipelineLayout({bindGroupLayouts:[this.postLayout]});
    const make=(entry:string,format:string)=>this.device.createRenderPipelineAsync({layout,vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:entry,targets:[{format}]},primitive:{topology:'triangle-list'}});
    this.postPipelines.bright=await make('bright','rgba16float');
    this.postPipelines.blur=await make('blur','rgba16float');
    this.postPipelines.composite=await make('composite',this.format);
    this.postSampler=this.device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
    this.postUniforms=Array.from({length:4},()=>this.device.createBuffer({size:48,usage:BUFFER_USAGE.UNIFORM|BUFFER_USAGE.COPY_DST}));
    this.rebuildPostGroups();
  }

  private rebuildPostGroups():void {
    if(!this.postLayout||!this.postSampler||this.postUniforms.length!==4||!this.sceneTexture||!this.pongTexture)return;
    const make=(source:any,bloom:any,index:number)=>this.device.createBindGroup({layout:this.postLayout,entries:[
      {binding:0,resource:source.createView()},{binding:1,resource:this.postSampler},
      {binding:2,resource:{buffer:this.postUniforms[index],offset:0,size:48}},{binding:3,resource:bloom.createView()}
    ]});
    this.postGroups=[make(this.sceneTexture,this.sceneTexture,0),make(this.brightTexture,this.brightTexture,1),make(this.pingTexture,this.pingTexture,2),make(this.sceneTexture,this.pongTexture,3)];
  }

  private encodePost(encoder:any,frame:WebGPUFrame):void {
    if(!this.postPipelines.composite||this.postGroups.length!==4)return;
    const settings=frame.postProcessing??{},enabled=settings.bloom!==false,uv=frame.sunUv??[0.5,0.5];
    const visible=frame.sunVisible?1:0;
    const strength=enabled?(settings.bloomStrength??0.28):0,exposure=settings.exposure??1;
    const hdr=settings.hdr!==false,acesEnabled=settings.toneMapping!=='reinhard';
    const glare=settings.glare===false?0:(settings.glareStrength??0.09);
    const flare=settings.lensFlare===false?0:(settings.lensFlareStrength??0.055);
    const write=(i:number,dx:number,dy:number)=>this.device.queue.writeBuffer(this.postUniforms[i],0,new Float32Array([
      settings.bloomThreshold??1.55,dx,dy,exposure,strength,uv[0],uv[1],visible,
      hdr?1:0,acesEnabled?1:0,glare,flare
    ]));
    write(0,0,0);write(1,1/Math.max(1,this.canvas.width),0);write(2,0,1/Math.max(1,this.canvas.height));write(3,0,0);
    const draw=(target:any,pipeline:any,group:any)=>{const p=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});p.setPipeline(pipeline);p.setBindGroup(0,group);p.draw(3);p.end();};
    if(enabled){draw(this.brightTexture,this.postPipelines.bright,this.postGroups[0]);draw(this.pingTexture,this.postPipelines.blur,this.postGroups[1]);draw(this.pongTexture,this.postPipelines.blur,this.postGroups[2]);}
    draw(this.context.getCurrentTexture(),this.postPipelines.composite,this.postGroups[3]);
  }

  private bindGroupLayout: any = null;

  private createGeometryBuffers(): void {
    const device = this.device;
    const makeBuffer = (data: ArrayBufferView, usage: number) => {
      const buffer = device.createBuffer({ size: Math.max(4, (data.byteLength + 3) & ~3), usage: usage | BUFFER_USAGE.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    const levels: Array<[number, number]> = [[10, 14], [22, 30], [44, 60], [128, 192]];
    levels.forEach(([latitude, longitude], lod) => {
      const geometry = createSphereGeometry(latitude, longitude);
      this.meshResources.set(lod, {
        positions: makeBuffer(geometry.positions, BUFFER_USAGE.VERTEX),
        normals: makeBuffer(geometry.normals, BUFFER_USAGE.VERTEX),
        indices: makeBuffer(geometry.indices, BUFFER_USAGE.INDEX),
        indexCount: geometry.indices.length
      });
    });
  }

  private resourcesFor(id: string): BodyGpuResources {
    let resources = this.bodyResources.get(id);
    if (resources) return resources;
    const uniform = this.device.createBuffer({ size: 368, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniform, offset: 0, size: 368 } }]
    });
    resources = { uniform, bindGroup };
    this.bodyResources.set(id, resources);
    return resources;
  }

  render(frame: WebGPUFrame): void {
    if (this.state !== 'ready' || !this.device || !this.context) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.min(1920, Math.round(rect.width * dpr)));
    const height = Math.max(1, Math.min(1080, Math.round(rect.height * dpr)));
    if (width !== this.canvas.width || height !== this.canvas.height) this.configure();

    if (frame.geodesicSettings && frame.bodies.some(body => body.surfaceProfile && body.surfaceProfile.kind !== 'gas-giant' && body.surfaceProfile.kind !== 'ice-giant')) {
      if (!this.geodesicSystem) this.geodesicSystem = new WebGPUGeodesicSurfaceSystem(this.device, frame.geodesicSettings);
      this.geodesicSystem.initializeStep();
      this.geodesicSystem.beginFrame();
    }
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.sceneTexture.createView(),
        clearValue: { r: 0.008, g: 0.016, b: 0.033, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    });
    pass.setPipeline(this.pipeline);
    const matrix = new Float32Array(92);
    for (const body of frame.bodies) {
      const usesGeodesicSurface = Boolean(body.surfaceProfile &&
        body.surfaceProfile.kind !== 'gas-giant' && body.surfaceProfile.kind !== 'ice-giant');
      if (usesGeodesicSurface) {
        this.geodesicSystem?.drawBody(
          pass, body, body.surfaceProfile!, frame.viewProjection, frame.cameraPosition,
          frame.sunPosition, frame.cameraForward ?? [0, 0, -1],
          frame.verticalFovRadians ?? Math.PI / 3,
          frame.viewportWidthPx ?? width, frame.viewportHeightPx ?? height
        );
        // Тверда планета не переходить на спрощену сферу, поки геодезичні сторінки завантажуються.
        continue;
      }
      pass.setPipeline(this.pipeline);
      const resources = this.resourcesFor(body.id);
      const mesh = this.meshResources.get(Math.max(0, Math.min(3, Math.floor(body.lod)))) ?? this.meshResources.get(2)!;
      pass.setVertexBuffer(0, mesh.positions); pass.setVertexBuffer(1, mesh.normals); pass.setIndexBuffer(mesh.indices, 'uint16');
      matrix.set(Array.from(body.model).slice(0, 16), 0);
      matrix.set(Array.from(frame.viewProjection).slice(0, 16), 16);
      matrix.set([body.color[0], body.color[1], body.color[2], 1], 32);
      const dx = frame.sunPosition[0] - body.position[0];
      const dy = frame.sunPosition[1] - body.position[1];
      const dz = frame.sunPosition[2] - body.position[2];
      const length = Math.hypot(dx, dy, dz) || 1;
      matrix.set([dx / length, dy / length, dz / length, body.star ? 1 : 0], 36);
      matrix.set([body.kind, body.seed, body.waterFraction, body.iceFraction], 40);
      matrix.set([body.ironFraction ?? 0, body.tectonicActivity ?? 0, body.volcanicActivity ?? 0, body.erosion ?? 0], 44);
      matrix.set([Number(frame.cameraPosition[0]), Number(frame.cameraPosition[1]), Number(frame.cameraPosition[2]), frame.timeSeconds], 48);
      matrix.set([body.eclipseVisibility ?? 1, 1, frame.sunRadius ?? 0, body.detail ?? 1], 52);
      matrix.set([frame.sunPosition[0], frame.sunPosition[1], frame.sunPosition[2], body.shadowsEnabled === false ? 0 : 1], 56);
      matrix.set(body.shadowOccluders ?? ZERO_SHADOW_OCCLUDERS, 60);
      this.device.queue.writeBuffer(resources.uniform, 0, matrix);
      pass.setBindGroup(0, resources.bindGroup);
      pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
    }
    this.geodesicSystem?.endFrame();
    pass.setPipeline(this.effectPipeline);
    for (const body of frame.bodies) {
      if (!body.atmosphere && !body.clouds?.length) continue;
      const mesh = this.meshResources.get(Math.max(0, Math.min(3, Math.floor(body.lod)))) ?? this.meshResources.get(2)!;
      const base = new Float32Array(92);
      base.set(Array.from(body.model).slice(0, 16), 0);
      base.set(Array.from(frame.viewProjection).slice(0, 16), 16);
      base.set([1, 1, 1, 1], 32);
      const dx = frame.sunPosition[0] - body.position[0], dy = frame.sunPosition[1] - body.position[1], dz = frame.sunPosition[2] - body.position[2];
      const lightLength = Math.hypot(dx, dy, dz) || 1;
      base.set([dx / lightLength, dy / lightLength, dz / lightLength, 0], 36);
      base.set([0, 0, 0, 0], 40);
      base.set([body.ironFraction ?? 0, body.tectonicActivity ?? 0, body.volcanicActivity ?? 0, body.erosion ?? 0], 44);
      base.set([Number(frame.cameraPosition[0]), Number(frame.cameraPosition[1]), Number(frame.cameraPosition[2]), frame.timeSeconds], 48);
      base.set([body.eclipseVisibility ?? 1, 1, frame.sunRadius ?? 0, body.detail ?? 1], 52);
      base.set([frame.sunPosition[0], frame.sunPosition[1], frame.sunPosition[2], body.shadowsEnabled === false ? 0 : 1], 56);
      base.set(body.shadowOccluders ?? ZERO_SHADOW_OCCLUDERS, 60);
      const drawShell = (resourceId: string, scale: number, color: readonly [number, number, number], params: readonly [number, number, number, number], surfaceParams: readonly [number, number, number, number] = [body.ironFraction ?? 0, body.tectonicActivity ?? 0, body.volcanicActivity ?? 0, body.erosion ?? 0]) => {
        const resources = this.resourcesFor(resourceId);
        const shell = new Float32Array(base);
        for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10]) shell[index] *= scale;
        shell.set([color[0], color[1], color[2], 1], 32);
        shell.set(params, 40);
        shell.set(surfaceParams, 44);
        this.device.queue.writeBuffer(resources.uniform, 0, shell);
        pass.setVertexBuffer(0, mesh.positions); pass.setVertexBuffer(1, mesh.normals); pass.setIndexBuffer(mesh.indices, 'uint16');
        pass.setBindGroup(0, resources.bindGroup);
        pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
      };
      if (body.atmosphere) {
        const atmosphere = body.atmosphere;
        drawShell(body.id + ':atmosphere', 1 + Math.max(0.0001, atmosphere.thicknessRatio), atmosphere.color,
          [9, atmosphere.intensity, atmosphere.thicknessRatio, atmosphere.mie]);
      }
      for (let cloudIndex = 0; cloudIndex < (body.clouds?.length ?? 0); cloudIndex++) {
        const cloud = body.clouds![cloudIndex];
        drawShell(body.id + ':cloud:' + cloudIndex, 1 + Math.max(0.0001, cloud.altitudeRatio), [0.82, 0.88, 0.96],
          [10, cloud.coverage, cloud.opacity, Math.max(1, cloud.scale)], [cloud.wind[0], cloud.wind[1], 0, 0]);
      }
    }
    const ringConfigs: Record<string, { inner: number; outer: number; color: readonly [number, number, number]; opacity: number }> = {
      saturn: { inner: 1.24, outer: 2.32, color: [0.72, 0.66, 0.54], opacity: 0.72 },
      jupiter: { inner: 1.28, outer: 1.82, color: [0.58, 0.53, 0.43], opacity: 0.22 },
      uranus: { inner: 1.45, outer: 2.05, color: [0.58, 0.68, 0.75], opacity: 0.28 },
      neptune: { inner: 1.48, outer: 2.0, color: [0.48, 0.55, 0.68], opacity: 0.20 }
    };
    for (const ringDraw of frame.rings) {
      const config = ringConfigs[ringDraw.id];
      if (!config || !this.ringVertexBuffer) continue;
      let resources = this.ringResources.get(ringDraw.id);
      if (!resources) {
        const uniform = this.device.createBuffer({ size: 160, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
        const bindGroup = this.device.createBindGroup({ layout: this.ringBindGroupLayout, entries: [{ binding: 0, resource: { buffer: uniform, offset: 0, size: 160 } }] });
        resources = { uniform, bindGroup }; this.ringResources.set(ringDraw.id, resources);
      }
      const uniforms = new Float32Array(40);
      uniforms.set(Array.from(frame.viewProjection).slice(0, 16), 0);
      uniforms.set(Array.from(ringDraw.model).slice(0, 16), 16);
      uniforms.set([config.color[0], config.color[1], config.color[2], 1], 32);
      uniforms.set([config.inner / config.outer, config.opacity, 0, 0], 36);
      this.device.queue.writeBuffer(resources.uniform, 0, uniforms);
      pass.setPipeline(this.ringPipeline); pass.setBindGroup(0, resources.bindGroup);
      pass.setVertexBuffer(0, this.ringVertexBuffer); pass.draw(this.ringVertexCount);
    }
    for (const orbit of frame.orbits) {
      let resources = this.orbitResources.get(orbit.id);
      const requiredBytes = Math.max(12, (orbit.points.byteLength + 3) & ~3);
      if (!resources || resources.capacity < requiredBytes) {
        resources?.vertex.destroy(); resources?.uniform.destroy();
        const vertex = this.device.createBuffer({ size: requiredBytes, usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST });
        const uniform = this.device.createBuffer({ size: 144, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
        const bindGroup = this.device.createBindGroup({ layout: this.orbitBindGroupLayout, entries: [{ binding: 0, resource: { buffer: uniform, offset: 0, size: 144 } }] });
        resources = { vertex, uniform, bindGroup, capacity: requiredBytes, points: null, count: 0 };
        this.orbitResources.set(orbit.id, resources);
      }
      if (resources.points !== orbit.points || resources.count !== orbit.points.length / 3) {
        this.device.queue.writeBuffer(resources.vertex, 0, orbit.points);
        resources.points = orbit.points; resources.count = orbit.points.length / 3;
      }
      const uniforms = new Float32Array(36);
      uniforms.set(Array.from(frame.viewProjection).slice(0, 16), 0);
      uniforms.set(Array.from(orbit.model).slice(0, 16), 16);
      uniforms.set([orbit.color[0], orbit.color[1], orbit.color[2], Math.max(0, Math.min(1, orbit.opacity))], 32);
      this.device.queue.writeBuffer(resources.uniform, 0, uniforms);
      pass.setPipeline(this.orbitPipeline); pass.setBindGroup(0, resources.bindGroup);
      pass.setVertexBuffer(0, resources.vertex); pass.draw(resources.count);
    }
    pass.end();
    this.encodePost(encoder, frame);
    this.device.queue.submit([encoder.finish()]);
  }

  async recover(): Promise<boolean> {
    if (this.recoveryAttempted || this.disposed) return false;
    this.recoveryAttempted = true;
    this.disposeGpuResources();
    this.state = 'initializing';
    try {
      await this.initialize();
      return true;
    } catch {
      return false;
    }
  }

  private disposeGpuResources(): void {
    this.geodesicSystem?.dispose(); this.geodesicSystem = null;
    for (const resources of this.bodyResources.values()) resources.uniform.destroy();
    this.bodyResources.clear();
    for (const resources of this.orbitResources.values()) { resources.vertex.destroy(); resources.uniform.destroy(); }
    this.orbitResources.clear();
    for (const resources of this.ringResources.values()) resources.uniform.destroy();
    this.ringResources.clear();
    this.ringVertexBuffer?.destroy?.(); this.ringVertexBuffer = null; this.ringVertexCount = 0;
    for (const mesh of this.meshResources.values()) { mesh.positions.destroy(); mesh.normals.destroy(); mesh.indices.destroy(); }
    this.meshResources.clear();
    this.depthTexture?.destroy?.(); this.depthTexture = null;
    for(const texture of [this.sceneTexture,this.brightTexture,this.pingTexture,this.pongTexture])texture?.destroy?.();
    this.sceneTexture=this.brightTexture=this.pingTexture=this.pongTexture=null;
    for(const buffer of this.postUniforms)buffer.destroy?.();
    this.postUniforms=[];this.postGroups=[];this.postLayout=null;this.postSampler=null;this.postPipelines={};
    this.pipeline = null;
    this.effectPipeline = null;
    this.orbitPipeline = null;
    this.orbitBindGroupLayout = null;
    this.ringPipeline = null;
    this.ringBindGroupLayout = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeGpuResources();
    this.device?.destroy();
    this.state = 'disposed';
  }
}
