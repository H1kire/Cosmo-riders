import type { GeodesicTileMesh } from '../geodesic/tile-mesh.ts';
import type { WebGPUSurfacePageCache } from './webgpu-surface-page-cache.ts';

const USAGE = { COPY_DST: 0x0008, INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040 };
interface GpuMesh { positions: any; normals: any; uv: any; indices: any; uniform: any; bindGroup: any; indexCount: number; }
export interface WebGPUGeodesicDraw {
  readonly viewProjection: ArrayLike<number>;
  readonly model: ArrayLike<number>;
  readonly radiusM: number;
  readonly pageLayer: number;
  readonly heightScale?: number;
  readonly albedoTint?: readonly [number, number, number];
  readonly lightDirection?: readonly [number, number, number];
  readonly cameraPosition?: readonly [number, number, number];
  readonly pageResolution?: number;
  readonly gutter?: number;
  readonly morph?: number;
  /** Частка дочірнього кольору під час піксельного переходу LOD. */
  readonly transitionAlpha?: number;
}

/** WebGPU-only indexed geodesic tile pipeline using all five generated surface channels. */
export class WebGPUGeodesicSurfaceRenderer {
  private readonly pipeline: any;
  private readonly layout: any;
  private readonly sampler: any;
  private readonly meshes = new Map<string, GpuMesh>();
  private disposed = false;

  private constructor(private readonly device: any, private readonly pages: WebGPUSurfacePageCache, pipeline: any, private readonly crossfadePipeline: any, layout: any, sampler: any) {
    this.pipeline = pipeline;
    this.layout = layout;
    this.sampler = sampler;
  }

  static async create(device: any, pages: WebGPUSurfacePageCache): Promise<WebGPUGeodesicSurfaceRenderer> {
    const shader = device.createShaderModule({ code: WGSL });
    const info = await shader.getCompilationInfo();
    const errors = info.messages.filter((item: any) => item.type === 'error');
    if (errors.length) throw new Error('Geodesic WGSL compilation failed: ' + errors.map((item: any) => item.message).join('; '));
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 1, buffer: { type: 'uniform', minBindingSize: 192 } },
      { binding: 1, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 2, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 3, visibility: 1, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
      { binding: 4, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 5, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 6, visibility: 2, sampler: { type: 'filtering' } }
    ] });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const vertex = { module: shader, entryPoint: 'vs', buffers: [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }
    ] };
    const pipeline = await device.createRenderPipelineAsync({
      layout: pipelineLayout,
      vertex,
      fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' }
    });
    // Дочірні тайли змішуються поверх повністю намальованого батьківського покриття.
    const crossfadePipeline = await device.createRenderPipelineAsync({
      layout: pipelineLayout,
      vertex,
      fragment: { module: shader, entryPoint: 'fs', targets: [{
        format: 'rgba16float',
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
        }
      }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    return new WebGPUGeodesicSurfaceRenderer(device, pages, pipeline, crossfadePipeline, layout, sampler);
  }

  uploadMesh(mesh: GeodesicTileMesh, meshKey = mesh.tileKey): void {
    if (this.disposed) throw new Error('Geodesic renderer is disposed.');
    const previous = this.meshes.get(meshKey);
    if (previous) return;
    const make = (data: ArrayBufferView, usage: number) => {
      const buffer = this.device.createBuffer({ label: 'Geodesic tile ' + meshKey, size: Math.max(4, (data.byteLength + 3) & ~3), usage: usage | USAGE.COPY_DST });
      this.device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    const uniform = this.device.createBuffer({ label: 'Geodesic tile uniforms ' + meshKey, size: 192, usage: USAGE.UNIFORM | USAGE.COPY_DST });
    const bindGroup = this.device.createBindGroup({ layout: this.layout, entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: this.pages.albedoView },
      { binding: 2, resource: this.pages.normalView },
      { binding: 3, resource: this.pages.heightView },
      { binding: 4, resource: this.pages.roughnessView },
      { binding: 5, resource: this.pages.materialView },
      { binding: 6, resource: this.sampler }
    ] });
    this.meshes.set(meshKey, {
      positions: make(mesh.directions, USAGE.VERTEX),
      normals: make(mesh.normals, USAGE.VERTEX),
      uv: make(mesh.textureCoordinates, USAGE.VERTEX),
      indices: make(mesh.indices, USAGE.INDEX),
      uniform, bindGroup, indexCount: mesh.indices.length
    });
  }

  hasMesh(tileKey: string): boolean { return this.meshes.has(tileKey); }

  meshKeysForBody(bodyId: string): string[] {
    const prefix = bodyId + '|';
    return [...this.meshes.keys()].filter(key => key.startsWith(prefix));
  }

  releaseMesh(tileKey: string): void {
    const mesh = this.meshes.get(tileKey);
    if (!mesh) return;
    mesh.positions.destroy?.(); mesh.normals.destroy?.(); mesh.uv.destroy?.(); mesh.indices.destroy?.(); mesh.uniform.destroy?.();
    this.meshes.delete(tileKey);
  }

  draw(pass: any, tileKey: string, draw: WebGPUGeodesicDraw): boolean {
    if (this.disposed) throw new Error('Geodesic renderer is disposed.');
    const mesh = this.meshes.get(tileKey);
    if (!mesh || !this.pages.ready || !Number.isInteger(draw.pageLayer) || draw.pageLayer < 0) return false;
    const uniform = this.uniformFor(mesh.uniform, draw);
    const transitionAlpha = Math.max(0, Math.min(1, draw.transitionAlpha ?? 1));
    pass.setPipeline(transitionAlpha < 1 ? this.crossfadePipeline : this.pipeline);
    pass.setBindGroup(0, mesh.bindGroup);
    pass.setVertexBuffer(0, mesh.positions);
    pass.setVertexBuffer(1, mesh.normals);
    pass.setVertexBuffer(2, mesh.uv);
    pass.setIndexBuffer(mesh.indices, 'uint32');
    pass.drawIndexed(mesh.indexCount, 1, 0, 0, 0);
    return true;
  }

  private uniformFor(buffer: any, draw: WebGPUGeodesicDraw): any {
    const data = new Float32Array(48);
    data.set(Array.from(draw.model).slice(0, 16), 0);
    data.set(Array.from(draw.viewProjection).slice(0, 16), 16);
    data.set([draw.radiusM, draw.pageLayer, draw.heightScale ?? 1, Math.max(0, Math.min(1, draw.morph ?? 1))], 32);
    data.set([...(draw.lightDirection ?? [0.42, 0.76, 0.38]), Math.max(0, Math.min(1, draw.transitionAlpha ?? 1))], 36);
    data.set([...(draw.cameraPosition ?? [0, 0, 0]), 1], 40);
    const resolution = draw.pageResolution ?? 1, gutter = draw.gutter ?? 0;
    data.set([resolution, resolution + gutter * 2, 0, 0], 44);
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes.values()) {
      mesh.positions.destroy?.(); mesh.normals.destroy?.(); mesh.uv.destroy?.(); mesh.indices.destroy?.(); mesh.uniform.destroy?.();
    }
    this.meshes.clear();
  }
}

const WGSL = `
struct U { model: mat4x4<f32>, vp: mat4x4<f32>, params: vec4<f32>, lightDirection: vec4<f32>, cameraPosition: vec4<f32>, pageInfo: vec4<f32>, };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var albedoTex: texture_2d_array<f32>;
@group(0) @binding(2) var normalTex: texture_2d_array<f32>;
@group(0) @binding(3) var heightTex: texture_2d_array<f32>;
@group(0) @binding(4) var roughTex: texture_2d_array<f32>;
@group(0) @binding(5) var materialTex: texture_2d_array<f32>;
@group(0) @binding(6) var surfaceSampler: sampler;

const PI: f32 = 3.141592653589793;
struct VIn { @location(0) direction: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>, };
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) worldNormal: vec3<f32>,
  @location(2) @interpolate(flat) layer: i32,
  @location(3) worldPosition: vec3<f32>,
};

@vertex fn vs(input: VIn) -> VOut {
  var out: VOut;
  let layer = i32(u.params.y);
  let resolution = max(u.pageInfo.x, 1.0);
  let pageSize = max(u.pageInfo.y, 1.0);
  let gutter = floor(max(pageSize - resolution, 0.0) * 0.5);
  let core = floor(input.uv * max(resolution - 1.0, 0.0)) + vec2<f32>(gutter);
  let heightCoord = clamp(vec2<i32>(core), vec2<i32>(0), vec2<i32>(pageSize) - vec2<i32>(1));
  let heightM = textureLoad(heightTex, heightCoord, layer, 0).r;
  let radiusRatio = 1.0 + (heightM * u.params.z * u.params.w) / max(u.params.x, 1.0);
  let local = input.direction * radiusRatio;
  let world = u.model * vec4<f32>(local, 1.0);
  out.clip = u.vp * world;
  out.uv = (core + vec2<f32>(0.5)) / pageSize;
  out.worldNormal = normalize((u.model * vec4<f32>(input.normal, 0.0)).xyz);
  out.worldPosition = world.xyz;
  out.layer = layer;
  return out;
}

fn fresnelSchlick(cosTheta: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
}
fn distributionGGX(nDotH: f32, roughness: f32) -> f32 {
  let alpha = roughness * roughness;
  let alpha2 = alpha * alpha;
  let denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
  return alpha2 / max(PI * denominator * denominator, 0.000001);
}
fn geometrySchlickGGX(nDotV: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) * 0.125;
  return nDotV / max(nDotV * (1.0 - k) + k, 0.000001);
}
fn geometrySmith(nDotV: f32, nDotL: f32, roughness: f32) -> f32 {
  return geometrySchlickGGX(nDotV, roughness) * geometrySchlickGGX(nDotL, roughness);
}

@fragment fn fs(input: VOut) -> @location(0) vec4<f32> {
  let layer = input.layer;
  let baseColor = textureSample(albedoTex, surfaceSampler, input.uv, layer).rgb;
  let encodedNormal = textureSample(normalTex, surfaceSampler, input.uv, layer).xyz * 2.0 - vec3<f32>(1.0);
  let mapNormal = normalize((u.model * vec4<f32>(encodedNormal, 0.0)).xyz);
  let geometricNormal = normalize(input.worldNormal);
  let normal = normalize(mix(geometricNormal, mapNormal, 0.96 * clamp(u.params.w, 0.0, 1.0)));
  let roughness = clamp(textureSample(roughTex, surfaceSampler, input.uv, layer).r, 0.045, 1.0);
  let materialId = i32(round(textureSample(materialTex, surfaceSampler, input.uv, layer).r * 255.0));
  let metallic = select(0.0, 0.12, materialId == 2);
  let light = normalize(u.lightDirection.xyz);
  let view = normalize(u.cameraPosition.xyz - input.worldPosition);
  let halfVector = normalize(light + view);
  let nDotL = max(dot(normal, light), 0.0);
  let nDotV = max(dot(normal, view), 0.0001);
  let nDotH = max(dot(normal, halfVector), 0.0);
  let hDotV = max(dot(halfVector, view), 0.0);
  let f0 = mix(vec3<f32>(0.04), baseColor, metallic);
  let fresnel = fresnelSchlick(hDotV, f0);
  let distribution = distributionGGX(nDotH, roughness);
  let geometry = geometrySmith(nDotV, nDotL, roughness);
  let specular = (distribution * geometry * fresnel) / max(4.0 * nDotV * max(nDotL, 0.0001), 0.0001);
  let diffuseWeight = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic);
  let diffuse = diffuseWeight * baseColor / PI;
  let direct = (diffuse + specular) * nDotL;

  // Небесне заповнення зберігає читабельність нічного боку без фальшивого другого джерела світла.
  let hemisphere = mix(0.018, 0.075, clamp(normal.y * 0.5 + 0.5, 0.0, 1.0));
  let ambientDiffuse = baseColor * diffuseWeight * hemisphere * (1.0 - roughness * 0.22);
  let ambientSpecular = fresnel * (0.012 + (1.0 - roughness) * 0.018);
  let radiance = direct + ambientDiffuse + ambientSpecular;
  return vec4<f32>(radiance, clamp(u.lightDirection.w, 0.0, 1.0));
}
`;
