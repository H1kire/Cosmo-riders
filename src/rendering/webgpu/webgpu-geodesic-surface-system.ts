import { GeodesicSurfaceRuntime, type GeodesicTileState } from '../geodesic/geodesic-surface-runtime.ts';
import { selectGeodesicLod, type GeodesicLodStats } from '../geodesic/quadtree-selector.ts';
import { baseGeoTiles, type GeoTile, type Vec3 } from '../geodesic/icosphere.ts';
import { VirtualSurfaceManager } from '../geodesic/virtual-surface-manager.ts';
import type { SurfaceProfile } from '../geodesic/surface-tile.ts';
import { WebGPUSurfacePageCache } from './webgpu-surface-page-cache.ts';
import { WebGPUSurfaceRuntime } from './webgpu-surface-runtime.ts';
import { WebGPUGeodesicSurfaceRenderer } from './webgpu-geodesic-surface-renderer.ts';
import { solarIrradianceForDisplay } from '../lighting/lighting-system.ts';

export interface WebGPUGeodesicSurfaceSettings {
  readonly pageResolution: number;
  readonly meshResolution: number;
  readonly gpuBudgetBytes: number;
  readonly cpuBudgetBytes: number;
  readonly workerCount: number;
  readonly uploadsPerFrame: number;
}
interface BodyLike {
  readonly id: string;
  readonly model: ArrayLike<number>;
  readonly position: readonly [number, number, number];
}
interface TopologyTransition {
  /** Попереднє повне покриття залишається видимим до готовності всіх нових листків. */
  readonly source: readonly GeodesicTileState[];
  targetSignature: string;
  /** Час початку змішування після повної готовності цільового покриття. */
  blendStartedAt: number | null;
}
interface PlanetTopology {
  readonly runtime: GeodesicSurfaceRuntime;
  splitKeys: Set<string>;
  visibleSignature: string | null;
  lastStats: GeodesicLodStats | null;
  lastSelection: { readonly tiles: readonly GeoTile[]; readonly stats: GeodesicLodStats } | null;
  lastSelectionCamera: Vec3 | null;
  lastSelectionForward: Vec3 | null;
  lastSelectionAt: number;
  lastSelectionFov: number;
  lastSelectionWidth: number;
  lastSelectionHeight: number;
  lastSelectionBudget: number;
  transition: TopologyTransition | null;
}
const MAX_PAGE_LAYERS = 256;
const METERS_PER_AU = 149597870700;
const LOD_CROSSFADE_MS = 420;
const clockNow = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

/** WebGPU geodesic renderer with screen-error Quadtree LOD, 2:1 balancing and edge stitching. */
export class WebGPUGeodesicSurfaceSystem {
  private readonly manager: VirtualSurfaceManager;
  private readonly pages: WebGPUSurfacePageCache;
  private readonly runtimes = new Map<string, WebGPUSurfaceRuntime>();
  private readonly topologies = new Map<string, PlanetTopology>();
  private readonly active = new Set<string>();
  private readonly desiredMeshes = new Map<string, Set<string>>();
  private readonly pendingMeshes = new Set<string>();
  private readonly meshMorphStartedAt = new Map<string, number>();
  private readonly meshLastUsedAt = new Map<string, number>();
  private renderer: WebGPUGeodesicSurfaceRenderer | null = null;
  private rendererPromise: Promise<void> | null = null;
  private rendererInitializationError: string | null = null;
  private disposed = false;
  private frameShadowOccluders = new Float32Array(32);
  private frameSunRadius = 0;
  private frameShadowsEnabled = true;
  private currentSunPosition: readonly [number, number, number] = [0, 0, 0];
  private currentSunIntensity = 1;
  private frameDrawCalls=0;
  private frameTriangles=0;
  private frameSubmittedVertices=0;
  private uploadsRemainingThisFrame=0;
  private readonly frameVisibleTiles=new Set<string>();

  constructor(private readonly device: any, private readonly settings: WebGPUGeodesicSurfaceSettings, private readonly sampleCount: 1 | 4 = 1) {
    this.manager = new VirtualSurfaceManager({ cpuBudgetBytes: settings.cpuBudgetBytes, workerCount: settings.workerCount });
    this.pages = new WebGPUSurfacePageCache(device, settings.pageResolution, 2, settings.gpuBudgetBytes, MAX_PAGE_LAYERS);
  }

  initializeStep(): void {
    if (this.disposed) return;
    if (!this.pages.ready) this.pages.initializeStep();
    if (this.pages.ready && !this.renderer && !this.rendererPromise && !this.rendererInitializationError) {
      this.rendererPromise = WebGPUGeodesicSurfaceRenderer.create(this.device, this.pages, this.sampleCount)
        .then(renderer => { if (this.disposed) renderer.dispose(); else this.renderer = renderer; })
        .catch(error => {
          this.rendererInitializationError = error instanceof Error ? error.message : String(error);
          this.rendererPromise = null;
        });
    }
  }

  beginFrame(): void {
    this.active.clear();this.desiredMeshes.clear();this.frameDrawCalls=0;this.frameTriangles=0;this.frameSubmittedVertices=0;this.uploadsRemainingThisFrame=this.settings.uploadsPerFrame;this.frameVisibleTiles.clear();
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
    viewportHeightPx: number,
    shadowOccluders: Float32Array = new Float32Array(32),
    sunRadius = 0,
    shadowsEnabled = true
  ): boolean {
    if (this.disposed || profile.kind === 'gas-giant' || profile.kind === 'ice-giant') return false;
    this.frameShadowOccluders.set(shadowOccluders);
    this.frameSunRadius = shadowsEnabled ? sunRadius : 0;
    this.frameShadowsEnabled = shadowsEnabled;
    this.currentSunPosition = sunPosition;
    const sunDistanceAU = Math.hypot(
      sunPosition[0] - body.position[0],
      sunPosition[1] - body.position[1],
      sunPosition[2] - body.position[2]
    );
    this.currentSunIntensity = solarIrradianceForDisplay(sunDistanceAU);
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
    // Резервуємо місце для повного попереднього покриття, навіть якщо бюджет GPU дорівнює лише 20 сторінкам.
    const sourceCount = topology.transition?.source.length ??
      topology.runtime.getTileStates().filter(state => state.visible).length;
    const transitionBudget = Math.max(20, this.pages.capacity - sourceCount);
    const selectionTime = clockNow();
    const previousCamera = topology.lastSelectionCamera;
    const previousForward = topology.lastSelectionForward;
    const cameraDistance = Math.hypot(...localCamera);
    const movementLimit = Math.max(profile.meanRadiusM * 0.0015, cameraDistance * 0.00025);
    const moved = !previousCamera || Math.hypot(
      localCamera[0] - previousCamera[0],
      localCamera[1] - previousCamera[1],
      localCamera[2] - previousCamera[2]
    ) > movementLimit;
    const rotated = !previousForward || dot(localForward, previousForward) < 0.99998;
    const selectionStale = selectionTime - topology.lastSelectionAt >= 120;
    const selectionChanged = moved || rotated || selectionStale ||
      topology.lastSelectionFov !== verticalFovRadians ||
      topology.lastSelectionWidth !== viewportWidthPx ||
      topology.lastSelectionHeight !== viewportHeightPx ||
      topology.lastSelectionBudget !== transitionBudget;
    let selection = topology.lastSelection;
    if (!selection || selectionChanged) {
      selection = selectGeodesicLod({
        positionM: localCamera,
        forward: localForward,
        verticalFovRadians,
        viewportWidthPx,
        viewportHeightPx
      }, {
        planetRadiusM: profile.meanRadiusM,
        targetErrorPx: this.settings.meshResolution >= 64 ? 1.5 : 2.5,
        maxDepth: 12,
        maxTiles: transitionBudget,
        previousSplitKeys: topology.splitKeys
      });
      topology.lastSelection = selection;
      topology.lastSelectionCamera = [...localCamera];
      topology.lastSelectionForward = [...localForward];
      topology.lastSelectionAt = selectionTime;
      topology.lastSelectionFov = verticalFovRadians;
      topology.lastSelectionWidth = viewportWidthPx;
      topology.lastSelectionHeight = viewportHeightPx;
      topology.lastSelectionBudget = transitionBudget;
    }

    if (!topology.transition && this.pages.capacity < 40) {
      // Якщо немає місця одночасно для кореневого та цільового наборів, залишаємо всі 20 граней без LOD-перемикання.
      selection = { tiles: baseGeoTiles(), stats: selection.stats };
    }

    const signature = selection.tiles.map(tile => tile.id.key).sort().join(',');
    if (signature !== topology.visibleSignature && !topology.transition) {
      try {
        const source = topology.runtime.getTileStates().filter(state => state.visible);
        if (source.length > 0 && source.length + Math.max(20, selection.tiles.length) <= this.pages.capacity) {
          topology.transition = { source, targetSignature: signature, blendStartedAt: null };
        }
        topology.runtime.reconcile(
          selection.tiles,
          new Set(selection.tiles.map(tile => tile.id.key)),
          topology.transition ? this.pages.capacity - topology.transition.source.length : this.pages.capacity
        );
        topology.visibleSignature = signature;
        topology.lastStats = selection.stats;
        topology.splitKeys = collectSplitKeys(topology.runtime.activeTiles);
      } catch {
        // Зберігаємо останню коректну збалансовану сітку, якщо кадр вичерпав бюджет сторінок.
      }
    }
    // Поки поточний LOD crossfade не завершений, не замінюємо його цільовий набір новим.
    // Це не дозволяє руху камери нескінченно скидати blendStartedAt і закріплювати обидва набори сторінок.

    const states = topology.runtime.getTileStates().filter(state => state.visible);
    const sourceStates = topology.transition?.source ?? [];
    const targetTiles = states.map(state => state.tile);
    const unionByKey = new Map<string, GeoTile>();
    for (const state of sourceStates) unionByKey.set(state.tile.id.key, state.tile);
    for (const tile of targetTiles) unionByKey.set(tile.id.key, tile);
    const retainedTiles = [...unionByKey.values()];
    const retainedMeshKeys = new Set([...sourceStates, ...states].map(state =>
      state.tile.id.key + ':' + this.settings.meshResolution + ':' + profile.meanRadiusM + ':' + state.stitchMask
    ));
    runtime.retainMeshes(retainedMeshKeys);
    runtime.setVisibleTiles(retainedTiles);
    const sourceKeys = new Set(sourceStates.map(state => state.tile.id.key));
    if (this.pages.ready && this.uploadsRemainingThisFrame > 0) {
      const started = runtime.startVisibleTileUploads(tile =>
        (sourceKeys.has(tile.id.key) ? 1_000_000 : 0) -
        tile.id.level * 100 +
        dot(tileCenter(tile), localCamera) / Math.max(1, Math.hypot(...localCamera)),
        this.uploadsRemainingThisFrame
      );
      this.uploadsRemainingThisFrame = Math.max(0, this.uploadsRemainingThisFrame - started);
    }

    const renderer = this.renderer;
    if (!renderer || targetTiles.length === 0) return false;
    const lightDirection = normalize([
      sunPosition[0] - body.position[0],
      sunPosition[1] - body.position[1],
      sunPosition[2] - body.position[2]
    ]);
    const desired = new Set<string>();
    const renderStates = topology.transition ? [...sourceStates, ...states] : states;
    const uniqueRenderStates = [...new Map(renderStates.map(state => [state.tile.id.key + '|s' + state.stitchMask, state])).values()];
    for (const state of uniqueRenderStates) {
      const tile = state.tile;
      const meshKey = body.id + '|' + tile.id.key + '|s' + state.stitchMask;
      desired.add(meshKey);
      if (!renderer.hasMesh(meshKey) && !this.pendingMeshes.has(meshKey) &&
          this.manager.pendingCount < this.manager.workerPool.maxPendingTasks) {
        this.pendingMeshes.add(meshKey);
        void runtime.requestTileMesh(
          tile, profile.meanRadiusM, this.settings.meshResolution, state.stitchMask,
          sourceKeys.has(tile.id.key) ? 10_000 : 10 + tile.id.level
        )
          .then(mesh => {
            if (!this.disposed && this.desiredMeshes.get(body.id)?.has(meshKey)) {
            renderer.uploadMesh(mesh, meshKey);
            this.meshMorphStartedAt.set(meshKey, clockNow());
          }
          })
          .catch(() => undefined)
          .finally(() => this.pendingMeshes.delete(meshKey));
      }
    }
    const targetItems = states.map(state => ({ state, layer: runtime.getPageLayer(state.tile.id.key), key: body.id + '|' + state.tile.id.key + '|s' + state.stitchMask }));
    const targetReady = targetItems.length > 0 && targetItems.every(item => item.layer !== undefined && renderer.hasMesh(item.key));
    if (topology.transition) {
      const sourceItems = sourceStates.map(state => ({ state, layer: runtime.getPageLayer(state.tile.id.key), key: body.id + '|' + state.tile.id.key + '|s' + state.stitchMask }));
      const sourceReady = sourceItems.length > 0 && sourceItems.every(item => item.layer !== undefined && renderer.hasMesh(item.key));
      this.desiredMeshes.set(body.id, desired);
      if (!sourceReady) return false;

      // Батьківська сітка спершу повністю заповнює кадр і записує коректну глибину.
      this.drawTileStates(pass, sourceItems, renderer, viewProjection, model, profile.meanRadiusM, lightDirection, cameraPosition, { transitionRole: 'source' });
      if (!targetReady) return true;

      const transition = topology.transition;
      if (transition.blendStartedAt === null) transition.blendStartedAt = clockNow();
      const blend = Math.min(1, Math.max(0, (clockNow() - transition.blendStartedAt) / LOD_CROSSFADE_MS));
      // Фрагментний alpha blending виконує попіксельне змішування кольорів дочірніх і батьківських сторінок.
      this.drawTileStates(pass, targetItems, renderer, viewProjection, model, profile.meanRadiusM, lightDirection, cameraPosition, {
        transitionAlpha: blend,
        transitionRole: 'blend',
        forceMorph: true
      });
      // Фіксуємо глибину дочірньої геометрії лише після її кольорового змішування.
      this.drawTileStates(pass, targetItems, renderer, viewProjection, model, profile.meanRadiusM, lightDirection, cameraPosition, {
        transitionAlpha: 1,
        transitionRole: 'depth',
        forceMorph: true
      });
      if (blend >= 1) {
        topology.transition = null;
        runtime.setVisibleTiles(targetTiles);
        runtime.retainMeshes(new Set(states.map(state => state.tile.id.key + ':' + this.settings.meshResolution + ':' + profile.meanRadiusM + ':' + state.stitchMask)));
        this.desiredMeshes.set(body.id, new Set(targetItems.map(item => item.key)));
      }
      return true;
    }
    this.desiredMeshes.set(body.id, new Set(targetItems.map(item => item.key)));
    if (!targetReady) return false;
    this.drawTileStates(pass, targetItems, renderer, viewProjection, model, profile.meanRadiusM, lightDirection, cameraPosition);
    return true;
  }

  afterSubmit(): void { this.renderer?.afterSubmit(); }

  endFrame(): void {
    for (const [id, runtime] of this.runtimes) if (!this.active.has(id)) runtime.setVisibleTiles([]);
    if (!this.renderer) return;

    // Зберігаємо нещодавно використані меші короткий час, щоб панорамування камери
    // не запускало повторну генерацію тих самих GPU-буферів на сусідніх кадрах.
    const now = clockNow();
    const desired = new Set<string>();
    for (const keys of this.desiredMeshes.values()) for (const key of keys) desired.add(key);
    const allKeys = this.renderer.meshKeys();
    const idle = allKeys
      .filter(key => !desired.has(key))
      .sort((a, b) => (this.meshLastUsedAt.get(a) ?? 0) - (this.meshLastUsedAt.get(b) ?? 0));
    const overBudget = Math.max(0, allKeys.length - 192);
    const staleBefore = now - 1500;
    let evicted = 0;
    for (const key of idle) {
      const lastUsed = this.meshLastUsedAt.get(key) ?? 0;
      if (lastUsed > staleBefore && evicted >= overBudget) continue;
      this.renderer.releaseMesh(key);
      this.meshMorphStartedAt.delete(key);
      this.meshLastUsedAt.delete(key);
      evicted++;
    }
  }

  getPlanetLodStats(bodyId: string): GeodesicLodStats | null {
    return this.topologies.get(bodyId)?.lastStats ?? null;
  }

  getFrameDiagnostics() {
    return { surfaceBodyCount: this.active.size, visibleGeodesicTiles: this.frameVisibleTiles.size, geodesicDrawCalls: this.frameDrawCalls, geodesicTriangles: this.frameTriangles, geodesicSubmittedVertices: this.frameSubmittedVertices };
  }

  getCacheDiagnostics() {
    const page = this.pages.diagnostics;
    const cpuStateCounts = this.manager.stateCounts;
    return {
      ...page,
      rendererInitializationError: this.rendererInitializationError,
      cpuCacheBytes: this.manager.memoryBytes,
      cpuCacheBudgetBytes: this.manager.cpuBudgetBytes,
      cpuCachePages: this.manager.cacheSize,
      generatedPages: cpuStateCounts['CPU Ready'] + cpuStateCounts['Upload Pending'] + cpuStateCounts['GPU Ready'] + cpuStateCounts.Visible,
      visiblePages: cpuStateCounts.Visible,
      queuedPages: cpuStateCounts.Queued,
      generatingPages: cpuStateCounts.Generating,
      failedPages: cpuStateCounts.Failed,
      workerCount: this.manager.workerCount,
      workerActive: this.manager.activeWorkers,
      workerQueued: this.manager.queuedCount,
      workerStartupErrors: this.manager.workerStartupErrors,
      workerRuntimeErrors: this.manager.workerRuntimeErrors,
      workerTaskErrors: this.manager.workerTaskErrors,
      cancelledTasks: this.manager.cancelledTasks,
      disposedTasks: this.manager.disposedTasks,
      workerRestarts: this.manager.workerRestarts,
      meshGenerationMs: this.manager.lastMeshGenerationMs,
      surfaceGenerationMs: this.manager.lastSurfaceGenerationMs,
      firstWorkerFailure: this.manager.startupFailure
    };
  }

  private drawTileStates(
    pass: any,
    items: readonly { readonly state: GeodesicTileState; readonly layer: number | undefined; readonly key: string }[],
    renderer: WebGPUGeodesicSurfaceRenderer,
    viewProjection: ArrayLike<number>,
    model: ArrayLike<number>,
    radiusM: number,
    lightDirection: readonly [number, number, number],
    cameraPosition: ArrayLike<number>,
    options: { readonly transitionAlpha?: number; readonly forceMorph?: boolean; readonly transitionRole?: 'source' | 'blend' | 'depth' } = {}
  ): void {
    for (const item of items) {
      if (item.layer === undefined) continue;
      const drawn=renderer.draw(pass, item.key, {
        viewProjection, model, radiusM, pageLayer: item.layer, lightDirection,
        lightIntensity: this.currentSunIntensity,
        cameraPosition: [Number(cameraPosition[0]), Number(cameraPosition[1]), Number(cameraPosition[2])],
        sunPosition: this.currentSunPosition,
        sunRadius: this.frameSunRadius,
        shadowOccluders: this.frameShadowOccluders,
        shadowsEnabled: this.frameShadowsEnabled,
        pageResolution: this.settings.pageResolution, gutter: 2,
        morph: options.forceMorph ? 1 : Math.min(1, Math.max(0, (clockNow() - (this.meshMorphStartedAt.get(item.key) ?? clockNow())) / 280)),
        transitionAlpha: options.transitionAlpha,
        transitionRole: options.transitionRole
      });
      if(drawn){const indexCount=renderer.getMeshIndexCount(item.key);this.meshLastUsedAt.set(item.key,clockNow());this.frameDrawCalls++;this.frameSubmittedVertices+=indexCount;this.frameTriangles+=Math.floor(indexCount/3);this.frameVisibleTiles.add(item.key);}
    }
  }

  private topologyFor(id: string): PlanetTopology {
    let topology = this.topologies.get(id);
    if (!topology) {
      const roots = baseGeoTiles();
      topology = {
        runtime: new GeodesicSurfaceRuntime(id, { maxDepth: 12, maxTiles: this.pages.capacity, stitchResolution: this.settings.meshResolution }),
        splitKeys: new Set<string>(),
        // Початковий стан відповідає повному набору двадцяти базових граней.
        visibleSignature: roots.map(tile => tile.id.key).sort().join(','),
        lastStats: null,
        lastSelection: null,
        lastSelectionCamera: null,
        lastSelectionForward: null,
        lastSelectionAt: 0,
        lastSelectionFov: 0,
        lastSelectionWidth: 0,
        lastSelectionHeight: 0,
        lastSelectionBudget: 0,
        transition: null
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
    this.meshMorphStartedAt.clear();
    this.meshLastUsedAt.clear();
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
