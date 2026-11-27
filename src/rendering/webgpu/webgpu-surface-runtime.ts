import { VirtualSurfaceManager } from '../geodesic/virtual-surface-manager.ts';
import type { GeoTile } from '../geodesic/icosphere.ts';
import type { SurfaceProfile, SurfaceTileRequest } from '../geodesic/surface-tile.ts';
import { WebGPUSurfacePageCache } from './webgpu-surface-page-cache.ts';

export interface WebGPUSurfaceRuntimeOptions {
  readonly resolution?: number;
  readonly gutter?: number;
  readonly gpuBudgetBytes?: number;
  readonly cpuBudgetBytes?: number;
  readonly maxPages?: number;
  readonly workerCount?: number;
}

/** Поєднує геодезичний CPU tile pipeline з WebGPU page cache без WebGL-шляху. */
export class WebGPUSurfaceRuntime {
  readonly manager: VirtualSurfaceManager;
  readonly pages: WebGPUSurfacePageCache;
  readonly profile: SurfaceProfile;
  readonly resolution: number;
  readonly gutter: number;
  private readonly seed: number;
  private readonly planetId: string;
  private readonly visible = new Map<string, GeoTile>();
  private readonly pinned = new Set<string>();
  private readonly inFlight = new Map<string, Promise<number | undefined>>();
  private disposed = false;

  constructor(
    device: any,
    planetId: string,
    profile: SurfaceProfile,
    options: WebGPUSurfaceRuntimeOptions = {},
    manager?: VirtualSurfaceManager
  ) {
    if (!planetId.trim()) throw new TypeError('Planet id must not be empty.');
    this.planetId = planetId;
    this.profile = profile;
    this.seed = profile.seed;
    this.resolution = options.resolution ?? 128;
    this.gutter = options.gutter ?? 2;
    if (!Number.isInteger(this.resolution) || this.resolution < 8 || this.resolution > 1024) {
      throw new RangeError('Surface tile resolution must be in [8, 1024].');
    }
    if (!Number.isInteger(this.gutter) || this.gutter < 0 || this.gutter > 16) {
      throw new RangeError('Surface tile gutter must be in [0, 16].');
    }
    this.manager = manager ?? new VirtualSurfaceManager({ cpuBudgetBytes: options.cpuBudgetBytes, workerCount: options.workerCount });
    this.pages = new WebGPUSurfacePageCache(
      device,
      this.resolution,
      this.gutter,
      options.gpuBudgetBytes ?? 64 * 1024 * 1024,
      options.maxPages ?? 20
    );
  }

  get ready(): boolean { return this.pages.ready; }
  get visibleTileCount(): number { return this.visible.size; }
  get pendingUploads(): number { return this.inFlight.size; }
  get residentPages(): number { return this.pages.residentPages; }

  /** Викликати по одному разу за кадр до завершення п'ятиетапного виділення GPU-масивів. */
  initializeStep(): boolean {
    if (this.disposed) throw new Error('WebGPU surface runtime is disposed.');
    return this.pages.initializeStep();
  }

  /** Синхронізує видимі листки Quadtree та закріплює їх сторінки від LRU-витіснення. */
  setVisibleTiles(tiles: readonly GeoTile[]): void {
    if (this.disposed) throw new Error('WebGPU surface runtime is disposed.');
    const next = new Map<string, GeoTile>();
    for (const tile of tiles) {
      if (next.has(tile.id.key)) throw new Error('Visible geodesic tile list contains duplicate keys.');
      next.set(tile.id.key, tile);
    }
    for (const key of this.pinned) {
      if (!next.has(key)) {
        this.pages.unpin(key);
        this.pinned.delete(key);
        this.manager.markVisible(key, false);
      }
    }
    this.visible.clear();
    for (const [key, tile] of next) {
      this.visible.set(key, tile);
      this.manager.markVisible(key, true);
      if (this.pages.getLayer(key) !== undefined && !this.pinned.has(key) && this.pages.pin(key)) {
        this.pinned.add(key);
      }
    }
  }

  /** Генерує відсутні сторінки через існуючий WorkerPool та завантажує п'ять каналів у WebGPU. */
  async uploadVisibleTiles(priority: (tile: GeoTile) => number = () => 0): Promise<void> {
    if (this.disposed) throw new Error('WebGPU surface runtime is disposed.');
    if (!this.pages.ready) throw new Error('WebGPU surface page arrays are not initialized.');
    const tasks: Promise<number | undefined>[] = [];
    for (const [key, tile] of this.visible) {
      const resident = this.pages.getLayer(key);
      if (resident !== undefined) {
        if (!this.pinned.has(key) && this.pages.pin(key)) this.pinned.add(key);
        continue;
      }
      let pending = this.inFlight.get(key);
      if (!pending) {
        const request: SurfaceTileRequest = {
          planetId: this.planetId,
          seed: this.seed,
          tile: tile.id,
          resolution: this.resolution,
          gutter: this.gutter,
          profile: this.profile
        };
        this.manager.markUploadPending(key);
        pending = this.manager.request(request, priority(tile)).then(surface => {
          if (this.disposed || !this.visible.has(key)) return undefined;
          const layer = this.pages.upload(surface);
          this.manager.markGpuReady(key);
          if (this.pages.pin(key)) this.pinned.add(key);
          return layer;
        }).finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, pending);
      }
      tasks.push(pending);
    }
    await Promise.all(tasks);
  }

  getPageLayer(tileKey: string): number | undefined {
    return this.pages.getLayer(tileKey);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of this.pinned) this.pages.unpin(key);
    this.pinned.clear();
    this.visible.clear();
    this.pages.dispose();
    this.manager.dispose();
    this.inFlight.clear();
  }
}
