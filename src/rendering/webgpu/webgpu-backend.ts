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
}

export interface WebGPUOrbitDraw { id: string; model: ArrayLike<number>; points: Float32Array; color: readonly [number, number, number]; opacity: number; }

export interface WebGPUFrame {
  viewProjection: ArrayLike<number>;
  bodies: readonly WebGPUBodyDraw[];
  orbits: readonly WebGPUOrbitDraw[];
  sunPosition: readonly [number, number, number];
}

interface BodyGpuResources { uniform: any; bindGroup: any; }
interface OrbitGpuResources { vertex: any; uniform: any; bindGroup: any; capacity: number; points: Float32Array | null; count: number; }

const BUFFER_USAGE = { COPY_DST: 0x0008, INDEX: 0x0010, VERTEX: 0x0020, UNIFORM: 0x0040 };
const TEXTURE_USAGE = { RENDER_ATTACHMENT: 0x0010 };

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
};

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let world = body.model * vec4<f32>(input.position, 1.0);
  output.clipPosition = body.viewProjection * world;
  output.worldNormal = normalize((body.model * vec4<f32>(input.normal, 0.0)).xyz);
  output.lightDirection = normalize(body.lightAndEmission.xyz);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (body.lightAndEmission.w > 0.5) {
    return vec4<f32>(body.color.rgb * 1.7, 1.0);
  }
  let diffuse = max(dot(normalize(input.worldNormal), normalize(input.lightDirection)), 0.0);
  let illumination = 0.12 + diffuse * 0.88;
  return vec4<f32>(body.color.rgb * illumination, 1.0);
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
  private depthTexture: any = null;
  private positionBuffer: any = null;
  private normalBuffer: any = null;
  private indexBuffer: any = null;
  private indexCount = 0;
  private readonly bodyResources = new Map<string, BodyGpuResources>();
  private readonly orbitResources = new Map<string, OrbitGpuResources>();
  private orbitPipeline: any = null;
  private orbitBindGroupLayout: any = null;
  private readonly geometry = createSphereGeometry(44, 60);
  private disposed = false;
  private recoveryAttempted = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    const started = performance.now();
    try {
      const gpu = (navigator as any).gpu;
      if (!gpu) throw new Error('navigator.gpu недоступен в этом браузере или origin.');
      this.adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!this.adapter) throw new Error('WebGPU adapter недоступен.');
      const limits = this.adapter.limits ?? {};
      const maxBuffer = Number(limits.maxBufferSize ?? 0);
      if (maxBuffer > 0 && maxBuffer < 1024 * 1024) throw new Error('WebGPU adapter сообщает слишком малый maxBufferSize.');
      this.device = await this.adapter.requestDevice();
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
    this.depthTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'depth24plus',
      usage: TEXTURE_USAGE.RENDER_ATTACHMENT
    });
  }

  private async createPipeline(): Promise<void> {
    const module = this.device.createShaderModule({ code: SHADER });
    const compilation = await module.getCompilationInfo();
    const errors = compilation.messages.filter((message: any) => message.type === 'error');
    if (errors.length) throw new Error('WGSL compilation failed: ' + errors.map((item: any) => item.message).join('; '));
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: 3, buffer: { type: 'uniform', minBindingSize: 160 } }]
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
        targets: [{ format: this.format }]
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
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
      fragment: { module: orbitModule, entryPoint: 'fragmentMain', targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
      primitive: { topology: 'line-strip' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' }
    });
  }

  private bindGroupLayout: any = null;

  private createGeometryBuffers(): void {
    const device = this.device;
    const makeBuffer = (data: ArrayBufferView, usage: number) => {
      const buffer = device.createBuffer({ size: Math.max(4, (data.byteLength + 3) & ~3), usage: usage | BUFFER_USAGE.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    this.positionBuffer = makeBuffer(this.geometry.positions, BUFFER_USAGE.VERTEX);
    this.normalBuffer = makeBuffer(this.geometry.normals, BUFFER_USAGE.VERTEX);
    this.indexBuffer = makeBuffer(this.geometry.indices, BUFFER_USAGE.INDEX);
    this.indexCount = this.geometry.indices.length;
  }

  private resourcesFor(id: string): BodyGpuResources {
    let resources = this.bodyResources.get(id);
    if (resources) return resources;
    const uniform = this.device.createBuffer({ size: 160, usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST });
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: uniform, offset: 0, size: 160 } }]
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

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
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
    pass.setVertexBuffer(0, this.positionBuffer);
    pass.setVertexBuffer(1, this.normalBuffer);
    pass.setIndexBuffer(this.indexBuffer, 'uint16');

    const matrix = new Float32Array(40);
    for (const body of frame.bodies) {
      const resources = this.resourcesFor(body.id);
      matrix.set(Array.from(body.model).slice(0, 16), 0);
      matrix.set(Array.from(frame.viewProjection).slice(0, 16), 16);
      matrix.set([body.color[0], body.color[1], body.color[2], 1], 32);
      const dx = frame.sunPosition[0] - body.position[0];
      const dy = frame.sunPosition[1] - body.position[1];
      const dz = frame.sunPosition[2] - body.position[2];
      const length = Math.hypot(dx, dy, dz) || 1;
      matrix.set([dx / length, dy / length, dz / length, body.star ? 1 : 0], 36);
      this.device.queue.writeBuffer(resources.uniform, 0, matrix);
      pass.setBindGroup(0, resources.bindGroup);
      pass.drawIndexed(this.indexCount, 1, 0, 0, 0);
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
    this.device.queue.submit([encoder.finish()]);
  }

  async recover(): Promise<boolean> {
    if (this.recoveryAttempted || this.disposed) return false;
    this.recoveryAttempted = true;
    this.disposeGpuResources();
    this.state = 'initializing';
    try {
      await this.initialize();
      return this.state === 'ready';
    } catch {
      return false;
    }
  }

  private disposeGpuResources(): void {
    for (const resources of this.bodyResources.values()) resources.uniform.destroy();
    this.bodyResources.clear();
    for (const resources of this.orbitResources.values()) { resources.vertex.destroy(); resources.uniform.destroy(); }
    this.orbitResources.clear();
    for (const resource of [this.positionBuffer, this.normalBuffer, this.indexBuffer, this.depthTexture]) resource?.destroy?.();
    this.positionBuffer = this.normalBuffer = this.indexBuffer = this.depthTexture = null;
    this.pipeline = null;
    this.orbitPipeline = null;
    this.orbitBindGroupLayout = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeGpuResources();
    this.device?.destroy();
    this.state = 'disposed';
  }
}
