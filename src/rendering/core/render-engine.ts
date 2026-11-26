import { RenderPipeline } from './render-pipeline.ts';
import type { RenderEngineOptions, RenderFrameContext, Vec3 } from './render-types.ts';

/**
 * Owns the only canvas context, WebGPU device and command submission path.
 * Passes share one encoder and one scene snapshot; no pass submits its own queue.
 */
export class RenderEngine {
  readonly pipeline = new RenderPipeline();
  readonly canvas: HTMLCanvasElement;
  readonly options: Required<Pick<RenderEngineOptions, 'pixelRatioCap' | 'maxWidth' | 'maxHeight' | 'alphaMode'>> & RenderEngineOptions;
  adapter: any = null;
  device: any = null;
  context: any = null;
  format = '';
  state: 'initializing' | 'ready' | 'lost' | 'failed' | 'disposed' = 'initializing';
  error: string | null = null;
  private frameNumber = 0;
  private lastFrameTime = 0;
  private recoveryPromise: Promise<boolean> | null = null;
  private depthTexture: any = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: RenderEngineOptions = {}) {
    this.canvas = canvas;
    this.options = {
      pixelRatioCap: options.pixelRatioCap ?? 1.5,
      maxWidth: options.maxWidth ?? 1920,
      maxHeight: options.maxHeight ?? 1080,
      alphaMode: options.alphaMode ?? 'opaque',
      ...options
    };
  }

  async initialize(): Promise<void> {
    if (this.disposed) throw new Error('RenderEngine is disposed.');
    if (this.state === 'ready') return;
    try {
      const gpu = (navigator as any).gpu;
      if (!gpu) throw new Error('WebGPU is unavailable. This application requires a browser with WebGPU enabled.');
      this.adapter = await gpu.requestAdapter();
      if (!this.adapter) throw new Error('No compatible WebGPU adapter was found.');
      this.device = await this.adapter.requestDevice();
      this.context = this.canvas.getContext('webgpu') as any;
      if (!this.context) throw new Error('The canvas could not create a GPUCanvasContext.');
      this.format = gpu.getPreferredCanvasFormat();
      this.configure();
      this.device.addEventListener?.('uncapturederror', (event: any) => {
        const error = new Error(event?.error?.message ?? 'Uncaptured WebGPU validation error.');
        this.error = error.message;
        this.options.onError?.(error);
      });
      this.device.lost.then((info: any) => {
        if (this.disposed) return;
        this.state = 'lost';
        const reason = info?.message || info?.reason || 'unknown reason';
        this.error = 'WebGPU device lost: ' + reason;
        this.options.onDeviceLost?.(this.error);
      });
      this.state = 'ready';
      this.error = null;
    } catch (cause) {
      this.state = 'failed';
      this.error = cause instanceof Error ? cause.message : String(cause);
      throw new Error(this.error);
    }
  }

  private configure(): void {
    if (!this.device || !this.context) throw new Error('WebGPU device and canvas context must be initialized.');
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(globalThis.devicePixelRatio || 1, this.options.pixelRatioCap);
    const width = Math.max(1, Math.min(this.options.maxWidth, Math.round(rect.width * ratio)));
    const height = Math.max(1, Math.min(this.options.maxHeight, Math.round(rect.height * ratio)));
    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({ device: this.device, format: this.format, alphaMode: this.options.alphaMode });
    this.depthTexture?.destroy?.();
    this.depthTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'depth24plus',
      usage: (globalThis as any).GPUTextureUsage?.RENDER_ATTACHMENT ?? 0x10
    });
  }

  resize(): void {
    if (this.state !== 'ready') return;
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(globalThis.devicePixelRatio || 1, this.options.pixelRatioCap);
    const width = Math.max(1, Math.min(this.options.maxWidth, Math.round(rect.width * ratio)));
    const height = Math.max(1, Math.min(this.options.maxHeight, Math.round(rect.height * ratio)));
    if (width !== this.canvas.width || height !== this.canvas.height) this.configure();
  }

  render(input: {
    timeSeconds: number;
    cameraPosition: Vec3;
    viewProjection: Float32Array;
    scene: unknown;
    clearColor?: readonly [number, number, number, number];
  }): boolean {
    if (this.state !== 'ready' || !this.device || !this.context) return false;
    try {
      this.resize();
      const width = this.canvas.width, height = this.canvas.height;
      const now = input.timeSeconds;
      const deltaSeconds = this.lastFrameTime ? Math.max(0, Math.min(0.25, now - this.lastFrameTime)) : 0;
      this.lastFrameTime = now;
      const encoder = this.device.createCommandEncoder({ label: 'Cosmo-riders frame ' + this.frameNumber });
      const colorView = this.context.getCurrentTexture().createView();
      const depthView = this.depthTexture.createView();
      const clear = input.clearColor ?? [0.008, 0.016, 0.033, 1];
      const context: RenderFrameContext = {
        device: this.device,
        queue: this.device.queue,
        encoder,
        colorView,
        depthView,
        width,
        height,
        pixelRatio: width / Math.max(1, this.canvas.clientWidth),
        timeSeconds: now,
        deltaSeconds,
        cameraPosition: input.cameraPosition,
        viewProjection: input.viewProjection,
        scene: input.scene
      };
      // Establish a shared color/depth target; scene passes load it, later passes may
      // use separate intermediate targets and append their own fullscreen passes.
      const clearPass = encoder.beginRenderPass({
        colorAttachments: [{ view: colorView, clearValue: { r: clear[0], g: clear[1], b: clear[2], a: clear[3] }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }
      });
      clearPass.end();
      this.pipeline.encode(context);
      this.device.queue.submit([encoder.finish()]);
      this.frameNumber++;
      return true;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.error = error.message;
      this.options.onError?.(error);
      return false;
    }
  }

  async recover(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.recoveryPromise) return this.recoveryPromise;
    this.recoveryPromise = (async () => {
      try {
        this.device?.destroy?.();
        this.device = null;
        this.adapter = null;
        this.context = null;
        this.state = 'initializing';
        await this.initialize();
        await this.pipeline.restore(this.device);
        this.frameNumber = 0;
        this.lastFrameTime = 0;
        return true;
      } catch {
        this.state = 'failed';
        return false;
      } finally {
        this.recoveryPromise = null;
      }
    })();
    return this.recoveryPromise;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pipeline.dispose();
    this.depthTexture?.destroy?.();
    this.depthTexture = null;
    this.context?.unconfigure?.();
    this.device?.destroy?.();
    this.state = 'disposed';
  }
}
