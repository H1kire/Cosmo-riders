import { GeodesicSurfaceRuntime } from '../geodesic/geodesic-surface-runtime.ts';
import { selectGeodesicLod, type GeodesicLodStats } from '../geodesic/quadtree-selector.ts';
import { baseGeoTiles, type GeoTile, type Vec3 } from '../geodesic/icosphere.ts';
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
interface PlanetTopology {
  readonly runtime: GeodesicSurfaceRuntime;
  splitKeys: Set<string>;
  visibleSignature: string | null;
  lastStats: GeodesicLodStats | null;
}
const MAX_PAGE_LAYERS = 256;
const METERS_PER_AU = 149597870700;

/** WebGPU geodesic renderer with screen-error Quadtree LOD, 2:1 balancing and edge stitching. */
export class WebGPUGeodesicSurfaceSystem {
  private readonly manager: VirtualSurfaceManager;
  private readonly pages: WebGPUSurfacePageCache;
  private readonly runtimes = new Map<string, WebGPUSurfaceRuntime>();
  private readonly topologies = new Map<string, PlanetTopology>();
  private readonly active = new Set<string>();
  private readonly desiredMeshes = new Map<string, Set<string>>();
  private readonly pendingMeshes = new Set<string>();
  private renderer: WebGPUGeodesicSurfaceRenderer | null = null;
  private rendererPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly device: any, private readonly settings: WebGPUGeodesicSurfaceSettings) {
    this.manager = new VirtualSurfaceManager({ cpuBudgetBytes: settings.cpuBudgetBytes, workerCount: settings.workerCount });
    this.pages = new WebGPUSurfacePageCache(device, settings.pageResolution, 2, settings.gpuBudgetBytes, MAX_PAGE_LAYERS);
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

  beginFrame(): void {
    this.active.clear();
    this.desiredMeshes.clear();
  }

  drawBody(
    pass: any,
    body: BodyLike,
    profile: SurfaceProfile,
    viewProjection: ArrayLike<number>,
    cameraPosition: ArrayLike<number>,
    sunPosition: readonly [number, number, number],
    cameraForward: ArrayLike<number>,
    verticalFovRadians: number,
    viewportWidthPx: number,
    viewportHeightPx: number
  ): boolean {
    if (this.disposed || profile.kind === 'gas-giant' || profile.kind === 'ice-giant') return false;
    const model = body.model;
    if (!Number.isFinite(Number(model[0])) || !Number.isFinite(Number(model[5]))) return false;

    // Переводимо відносну позицію камери з AU у метри та в локальну систему планети.
    const cameraDeltaWorld: Vec3 = [
      (Number(cameraPosition[0]) - body.position[0]) * METERS_PER_AU,
      (Number(cameraPosition[1]) - body.position[1]) * METERS_PER_AU,
      (Number(cameraPosition[2]) - body.position[2]) * METERS_PER_AU
    ];
    const axisX = normalize([Number(model[0]), Number(model[1]), Number(model[2])]);
    const axisY = normalize([Number(model[4]), Number(model[5]), Number(model[6])]);
    const axisZ = normalize([Number(model[8]), Number(model[9]), Number(model[10])]);
    const localCamera: Vec3 = [dot(cameraDeltaWorld, axisX), dot(cameraDeltaWorld, axisY), dot(cameraDeltaWorld, axisZ)];
    const forwardWorld = normalize([Number(cameraForward[0]), Number(cameraForward[1]), Number(cameraForward[2])]);
    const localForward: Vec3 = normalize([dot(forwardWorld, axisX), dot(forwardWorld, axisY), dot(forwardWorld, axisZ)]);

    const runtime = this.runtimeFor(body.id, profile);
    const topology = this.topologyFor(body.id);
    this.active.add(body.id);
    const selection = selectGeodesicLod({
      positionM: localCamera,
      forward: localForward,
      verticalFovRadians,
      viewportWidthPx,
      viewportHeightPx
    }, {
      planetRadiusM: profile.meanRadiusM,
      targetErrorPx: this.settings.meshResolution >= 64 ? 1.5 : 2.5,
      maxDepth: 12,
      maxTiles: this.pages.capacity,
      previousSplitKeys: topology.splitKeys
    });

    const signature = selection.tiles.map(tile => tile.id.key).sort().join(',');
    if (signature !== topology.visibleSignature) {
      try {
        topology.runtime.reconcile(selection.tiles, new Set(selection.tiles.map(tile => tile.id.key)));
        topology.visibleSignature = signature;
        topology.lastStats = selection.stats;
        topology.splitKeys = collectSplitKeys(selection.tiles);
      } catch {
        // Зберігаємо останню коректну збалансовану сітку, якщо кадр вичерпав бюджет сторінок.
      }
    }

    const states = topology.runtime.getTileStates().filter(state => state.visible);
    const visible = states.map(state => state.tile);
    const retainedMeshKeys = new Set(states.map(state =>
      state.tile.id.key + ':' + this.settings.meshResolution + ':' + profile.meanRadiusM + ':' + state.stitchMask
    ));
    runtime.retainMeshes(retainedMeshKeys);
    runtime.setVisibleTiles(visible);
    if (this.pages.ready) {
      void runtime.uploadVisibleTiles(tile =>
        tile.id.level * 100 + dot(tileCenter(tile), localCamera) / Math.max(1, Math.hypot(...localCamera))
      ).catch(() => undefined);
    }

    const renderer = this.renderer;
    if (!renderer || visible.length === 0) return false;
    const lightDirection = normalize([
      sunPosition[0] - body.position[0],
      sunPosition[1] - body.position[1],
      sunPosition[2] - body.position[2]
    ]);
    const desired = new Set<string>();
    for (const state of states) {
      const tile = state.tile;
      const meshKey = body.id + '|' + tile.id.key + '|s' + state.stitchMask;
      desired.add(meshKey);
      if (!renderer.hasMesh(meshKey) && !this.pendingMeshes.has(meshKey) &&
          this.manager.pendingCount < this.manager.workerPool.maxPendingTasks) {
        this.pendingMeshes.add(meshKey);
        void runtime.requestTileMesh(tile, profile.meanRadiusM, this.settings.meshResolution, state.stitchMask, 10 + tile.id.level)
          .then(mesh => {
            if (!this.disposed && this.desiredMeshes.get(body.id)?.has(meshKey)) renderer.uploadMesh(mesh, meshKey);
          })
          .catch(() => undefined)
          .finally(() => this.pendingMeshes.delete(meshKey));
      }
    }
    this.desiredMeshes.set(body.id, desired);

    const drawItems = states.map(state => ({
      state,
      layer: runtime.getPageLayer(state.tile.id.key),
      key: body.id + '|' + state.tile.id.key + '|s' + state.stitchMask
    }));
    if (drawItems.some(item => item.layer === undefined || !renderer.hasMesh(item.key))) return false;
    for (const item of drawItems) {
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
    if (!this.renderer) return;
    for (const id of this.runtimes.keys()) {
      const desired = this.desiredMeshes.get(id) ?? new Set<string>();
      for (const key of this.renderer.meshKeysForBody(id)) if (!desired.has(key)) this.renderer.releaseMesh(key);
    }
  }

  getPlanetLodStats(bodyId: string): GeodesicLodStats | null {
    return this.topologies.get(bodyId)?.lastStats ?? null;
  }

  private topologyFor(id: string): PlanetTopology {
    let topology = this.topologies.get(id);
    if (!topology) {
      topology = {
        runtime: new GeodesicSurfaceRuntime(id, { maxDepth: 12, maxTiles: this.pages.capacity, stitchResolution: this.settings.meshResolution }),
        splitKeys: new Set<string>(),
        visibleSignature: null,
        lastStats: null
      };
      this.topologies.set(id, topology);
    }
    return topology;
  }

  private runtimeFor(id: string, profile: SurfaceProfile): WebGPUSurfaceRuntime {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = new WebGPUSurfaceRuntime(this.device, id, profile, {
        resolution: this.settings.pageResolution, gutter: 2,
        gpuBudgetBytes: this.settings.gpuBudgetBytes, cpuBudgetBytes: this.settings.cpuBudgetBytes,
        workerCount: this.settings.workerCount, maxPages: MAX_PAGE_LAYERS
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
    this.topologies.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.manager.dispose();
    this.pages.dispose();
    this.pendingMeshes.clear();
    this.desiredMeshes.clear();
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
function collectSplitKeys(tiles: readonly GeoTile[]): Set<string> {
  const keys = new Set<string>();
  for (const tile of tiles) {
    for (let length = 0; length < tile.id.path.length; length++) {
      keys.add(tile.id.face.toString(36) + ':' + (length === 0 ? 'root' : tile.id.path.slice(0, length)));
    }
  }
  return keys;
}
