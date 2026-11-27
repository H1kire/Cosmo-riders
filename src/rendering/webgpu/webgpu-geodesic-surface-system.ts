import { baseGeoTiles, type GeoTile } from '../geodesic/icosphere.ts';
import { VirtualSurfaceManager } from '../geodesic/virtual-surface-manager.ts';
import type { SurfaceProfile } from '../geodesic/surface-tile.ts';
import { WebGPUSurfacePageCache } from './webgpu-surface-page-cache.ts';
import { WebGPUSurfaceRuntime } from './webgpu-surface-runtime.ts';
import { WebGPUGeodesicSurfaceRenderer } from './webgpu-geodesic-surface-renderer.ts';

export interface WebGPUGeodesicSurfaceSettings {
  readonly pageResolution: number;
  readonly meshResolution: number;
  readonly gpuBudgetBytes: number;
  readonly cpuBudgetBytes: number;
  readonly workerCount: number;
}

interface BodyLike {
  readonly id: string;
  readonly model: ArrayLike<number>;
  readonly position: readonly [number, number, number];
}

/** Єдина геодезична WebGPU-система з глобальним кешем сторінок і спільним Worker Pool. */
export class WebGPUGeodesicSurfaceSystem {
  private readonly manager: VirtualSurfaceManager;
  private readonly pages: WebGPUSurfacePageCache;
  private readonly runtimes = new Map<string, WebGPUSurfaceRuntime>();
  private readonly active = new Set<string>();
  private renderer: WebGPUGeodesicSurfaceRenderer | null = null;
  private rendererPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly device: any, private readonly settings: WebGPUGeodesicSurfaceSettings) {
    this.manager = new VirtualSurfaceManager({ cpuBudgetBytes: settings.cpuBudgetBytes, workerCount: settings.workerCount });
    this.pages = new WebGPUSurfacePageCache(device, settings.pageResolution, 2, settings.gpuBudgetBytes, 20);
  }

  initializeStep(): void {
    if (this.disposed) return;
    if (!this.pages.ready) this.pages.initializeStep();
    if (this.pages.ready && !this.renderer && !this.rendererPromise) {
      this.rendererPromise = WebGPUGeodesicSurfaceRenderer.create(this.device, this.pages)
        .then(renderer => { if (this.disposed) renderer.dispose(); else this.renderer = renderer; })
        .catch(() => { this.rendererPromise = null; });
    }
  }

  beginFrame(): void { this.active.clear(); }

  drawBody(
    pass: any,
    body: BodyLike,
    profile: SurfaceProfile,
    viewProjection: ArrayLike<number>,
    cameraPosition: ArrayLike<number>,
    sunPosition: readonly [number, number, number]
  ): boolean {
    if (this.disposed || profile.kind === 'gas-giant' || profile.kind === 'ice-giant') return false;
    const model = body.model;
    const radiusWorld = Math.hypot(Number(model[0]), Number(model[1]), Number(model[2]));
    const cameraDelta: [number, number, number] = [
      Number(cameraPosition[0]) - body.position[0],
      Number(cameraPosition[1]) - body.position[1],
      Number(cameraPosition[2]) - body.position[2]
    ];
    const cameraDistance = Math.hypot(...cameraDelta);
    if (radiusWorld <= 0 || cameraDistance / radiusWorld > 500) {
      this.runtimes.get(body.id)?.setVisibleTiles([]);
      return false;
    }

    const runtime = this.runtimeFor(body.id, profile);
    this.active.add(body.id);
    const cameraDirection = normalize(cameraDelta);
    const axisX = normalize([Number(model[0]), Number(model[1]), Number(model[2])]);
    const axisY = normalize([Number(model[4]), Number(model[5]), Number(model[6])]);
    const axisZ = normalize([Number(model[8]), Number(model[9]), Number(model[10])]);
    const localCamera: [number, number, number] = [
      dot(cameraDirection, axisX), dot(cameraDirection, axisY), dot(cameraDirection, axisZ)
    ];
    const visible = baseGeoTiles().filter(tile => dot(tileCenter(tile), localCamera) > -0.16);
    runtime.setVisibleTiles(visible);
    if (this.pages.ready) void runtime.uploadVisibleTiles(tile => 1 + dot(tileCenter(tile), localCamera)).catch(() => undefined);

    const lightDirection = normalize([
      sunPosition[0] - body.position[0],
      sunPosition[1] - body.position[1],
      sunPosition[2] - body.position[2]
    ]);
    for (const tile of visible) {
      const meshKey = body.id + '|' + tile.id.key;
      void runtime.requestTileMesh(tile, profile.meanRadiusM, this.settings.meshResolution, 0, 1)
        .then(mesh => { this.renderer?.uploadMesh(mesh, meshKey); })
        .catch(() => undefined);
    }

    const renderer = this.renderer;
    if (!renderer || visible.length === 0) return false;
    const layers = visible.map(tile => ({ tile, layer: runtime.getPageLayer(tile.id.key), key: body.id + '|' + tile.id.key }));
    if (layers.some(item => item.layer === undefined || !renderer.hasMesh(item.key))) return false;
    for (const item of layers) {
      renderer.draw(pass, item.key, {
        viewProjection, model, radiusM: profile.meanRadiusM, pageLayer: item.layer!, lightDirection,
        cameraPosition: [Number(cameraPosition[0]), Number(cameraPosition[1]), Number(cameraPosition[2])],
        pageResolution: this.settings.pageResolution, gutter: 2
      });
    }
    return true;
  }

  endFrame(): void {
    for (const [id, runtime] of this.runtimes) if (!this.active.has(id)) runtime.setVisibleTiles([]);
  }

  private runtimeFor(id: string, profile: SurfaceProfile): WebGPUSurfaceRuntime {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = new WebGPUSurfaceRuntime(this.device, id, profile, {
        resolution: this.settings.pageResolution, gutter: 2,
        gpuBudgetBytes: this.settings.gpuBudgetBytes, cpuBudgetBytes: this.settings.cpuBudgetBytes,
        workerCount: this.settings.workerCount, maxPages: 20
      }, this.manager, this.pages);
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const runtime of this.runtimes.values()) runtime.dispose();
    this.runtimes.clear();
    this.renderer?.dispose(); this.renderer = null;
    this.manager.dispose();
    this.pages.dispose();
  }
}

function normalize(value: readonly number[]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}
function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function tileCenter(tile: GeoTile): [number, number, number] {
  return normalize([
    tile.triangle.a[0] + tile.triangle.b[0] + tile.triangle.c[0],
    tile.triangle.a[1] + tile.triangle.b[1] + tile.triangle.c[1],
    tile.triangle.a[2] + tile.triangle.b[2] + tile.triangle.c[2]
  ]);
}
