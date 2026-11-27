import { VirtualSurfaceManager } from '../geodesic/virtual-surface-manager.ts';
import type { GeoTile } from '../geodesic/icosphere.ts';
import type { GeodesicTileMesh } from '../geodesic/tile-mesh.ts';
import { surfaceTileKey, type SurfaceProfile, type SurfaceTileRequest } from '../geodesic/surface-tile.ts';
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
  private readonly meshInFlight = new Map<string, Promise<GeodesicTileMesh>>();
  private readonly meshes = new Map<string, GeodesicTileMesh>();
  private disposed = false;
  private readonly ownsManager: boolean;
  private readonly ownsPages: boolean;

  constructor(
    device: any,
    planetId: string,
    profile: SurfaceProfile,
    options: WebGPUSurfaceRuntimeOptions = {},
    manager?: VirtualSurfaceManager,
    sharedPages?: WebGPUSurfacePageCache
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
    this.ownsManager = !manager;
    this.ownsPages = !sharedPages;
    this.manager = manager ?? new VirtualSurfaceManager({ cpuBudgetBytes: options.cpuBudgetBytes, workerCount: options.workerCount });
    this.pages = sharedPages ?? new WebGPUSurfacePageCache(
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
  get residentMeshes(): number { return this.meshes.size; }
  get pendingMeshes(): number { return this.meshInFlight.size; }

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
    const nextPageKeys = new Set([...next.values()].map(tile => this.requestFor(tile)).map(surfaceTileKey));
    for (const key of this.pinned) {
      if (!nextPageKeys.has(key)) {
        this.pages.unpin(key);
        this.pinned.delete(key);
        this.manager.markVisible(key, false);
      }
    }
    this.visible.clear();
    for (const [key, tile] of next) {
      this.visible.set(key, tile);
      const pageKey = surfaceTileKey(this.requestFor(tile));
      this.manager.markVisible(pageKey, true);
      if (this.pages.getLayer(pageKey) !== undefined && !this.pinned.has(pageKey) && this.pages.pin(pageKey)) {
        this.pinned.add(pageKey);
      }
    }
  }

  /** Генерує відсутні сторінки через існуючий WorkerPool та завантажує п'ять каналів у WebGPU. */
  async uploadVisibleTiles(priority: (tile: GeoTile) => number = () => 0): Promise<void> {
    if (this.disposed) throw new Error('WebGPU surface runtime is disposed.');
    if (!this.pages.ready) throw new Error('WebGPU surface page arrays are not initialized.');
    const tasks: Promise<number | undefined>[] = [];
    for (const [tileKey, tile] of this.visible) {
      const request = this.requestFor(tile);
      const pageKey = surfaceTileKey(request);
      const resident = this.pages.getLayer(pageKey);
      if (resident !== undefined) {
        if (!this.pinned.has(pageKey) && this.pages.pin(pageKey)) this.pinned.add(pageKey);
        continue;
      }
      let pending = this.inFlight.get(pageKey);
      if (!pending) {
        this.manager.markUploadPending(pageKey);
        pending = this.manager.request(request, priority(tile)).then(surface => {
          if (this.disposed || !this.visible.has(tileKey)) return undefined;
          const layer = this.pages.upload(surface);
          this.manager.markGpuReady(pageKey);
          if (this.pages.pin(pageKey)) this.pinned.add(pageKey);
          return layer;
        }).finally(() => this.inFlight.delete(pageKey));
        this.inFlight.set(pageKey, pending);
      }
      tasks.push(pending);
    }
    await Promise.all(tasks);
  }

  /** Отримує індексований трикутний меш з того самого обмеженого Worker Pool. */
  async requestTileMesh(tile: GeoTile, radiusM: number, resolution = 32, coarseEdgeMask = 0, priority = 0): Promise<GeodesicTileMesh> {
    if (this.disposed) throw new Error('WebGPU surface runtime is disposed.');
    const key = tile.id.key + ':' + resolution + ':' + radiusM + ':' + coarseEdgeMask;
    const cached = this.meshes.get(key);
    if (cached) return cached;
    let pending = this.meshInFlight.get(key);
    if (!pending) {
      pending = this.manager.requestMesh(tile, resolution, radiusM, priority, undefined, coarseEdgeMask).then(mesh => {
        if (!this.disposed) this.meshes.set(key, mesh);
        return mesh;
      }).finally(() => this.meshInFlight.delete(key));
      this.meshInFlight.set(key, pending);
    }
    return pending;
  }

  getPageLayer(tileKey: string): number | undefined {
    const tile = this.visible.get(tileKey);
    return tile ? this.pages.getLayer(surfaceTileKey(this.requestFor(tile))) : undefined;
  }

  private requestFor(tile: GeoTile): SurfaceTileRequest {
    return {
      planetId: this.planetId,
      seed: this.seed,
      tile: tile.id,
      resolution: this.resolution,
      gutter: this.gutter,
      profile: this.profile
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of this.pinned) this.pages.unpin(key);
    this.pinned.clear();
    this.visible.clear();
    if (this.ownsPages) this.pages.dispose();
    if (this.ownsManager) this.manager.dispose();
    this.inFlight.clear();
    this.meshInFlight.clear();
    this.meshes.clear();
  }
}
