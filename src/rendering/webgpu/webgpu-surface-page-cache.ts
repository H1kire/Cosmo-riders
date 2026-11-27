import type { SurfaceTileData } from '../geodesic/surface-tile.ts';

const TEXTURE_USAGE = { COPY_DST: 0x0002, TEXTURE_BINDING: 0x0004 };
const COPY_ROW_ALIGNMENT = 256;

interface PageSlot { key: string | null; used: number; }

/** WebGPU virtual-surface pages: five independently sampled 2D-array channels. */
export class WebGPUSurfacePageCache {
  readonly pageSize: number;
  readonly capacity: number;
  private readonly textures: any[] = [];
  private readonly slots: PageSlot[] = [];
  private readonly pages = new Map<string, number>();
  private readonly pins = new Map<string, number>();
  private clock = 0;
  private disposed = false;
  private uploadCountValue = 0;
  private uploadFailureCountValue = 0;
  private evictionCountValue = 0;
  private cacheHitCountValue = 0;
  private cacheMissCountValue = 0;
  private highWaterResidentPagesValue = 0;

  constructor(
    private readonly device: any,
    resolution: number,
    gutter = 2,
    readonly budgetBytes = 64 * 1024 * 1024,
    maxPages = 20
  ) {
    if (!Number.isInteger(resolution) || resolution < 1) throw new RangeError('Surface page resolution must be positive.');
    if (!Number.isInteger(gutter) || gutter < 0) throw new RangeError('Surface page gutter must not be negative.');
    if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) throw new RangeError('Surface page budget must be positive.');
    this.pageSize = resolution + gutter * 2;
    const limits = device?.limits ?? {};
    const maxDimension = Number(limits.maxTextureDimension2D ?? this.pageSize);
    const maxLayers = Number(limits.maxTextureArrayLayers ?? 1);
    if (this.pageSize > maxDimension) throw new RangeError('Surface page exceeds maxTextureDimension2D.');
    const bytesPerPage = this.pageSize * this.pageSize * 14;
    this.capacity = Math.min(maxLayers, maxPages, Math.floor(budgetBytes / bytesPerPage));
    if (!Number.isInteger(this.capacity) || this.capacity < 1) {
      throw new Error('WebGPU texture-array budget or layer limit cannot hold one surface page.');
    }
    for (let index = 0; index < this.capacity; index++) this.slots.push({ key: null, used: 0 });
  }

  get ready(): boolean { return this.textures.length === 5; }
  get allocatedTextureCount(): number { return this.textures.length; }
  get residentPages(): number { return this.pages.size; }
  get pinnedPages(): number { return this.pins.size; }
  /** Estimated GPU allocation represented by texture descriptors; WebGPU exposes no VRAM-usage query. */
  get pageBytes(): number { return this.pageSize * this.pageSize * 14; }
  get capacityBytes(): number { return this.pageBytes * this.capacity; }
  /** Bytes allocated in created texture arrays, not a driver-reported physical VRAM counter. */
  get allocatedBytes(): number { return this.pageSize * this.pageSize * this.capacity * [4, 4, 4, 1, 1].slice(0, this.textures.length).reduce((sum, value) => sum + value, 0); }
  get residentBytes(): number { return this.pages.size * this.pageBytes; }
  get freePages(): number { return this.capacity - this.pages.size; }
  get unpinnedResidentPages(): number { return [...this.pages.keys()].filter(key => !this.isPinned(key)).length; }
  get uploadCount(): number { return this.uploadCountValue; }
  get uploadFailureCount(): number { return this.uploadFailureCountValue; }
  get evictionCount(): number { return this.evictionCountValue; }
  get cacheHitCount(): number { return this.cacheHitCountValue; }
  get cacheMissCount(): number { return this.cacheMissCountValue; }
  get highWaterResidentPages(): number { return this.highWaterResidentPagesValue; }
  get diagnostics() {
    return {
      pageSize: this.pageSize, pageBytes: this.pageBytes, capacity: this.capacity,
      budgetBytes: this.budgetBytes, capacityBytes: this.capacityBytes,
      allocatedBytes: this.allocatedBytes, residentBytes: this.residentBytes,
      residentPages: this.residentPages, pinnedPages: this.pinnedPages,
      unpinnedResidentPages: this.unpinnedResidentPages, freePages: this.freePages,
      allocatedTextureArrays: this.allocatedTextureCount, ready: this.ready,
      uploadCount: this.uploadCount, uploadFailureCount: this.uploadFailureCount,
      evictionCount: this.evictionCount, cacheHitCount: this.cacheHitCount,
      cacheMissCount: this.cacheMissCount, highWaterResidentPages: this.highWaterResidentPages
    };
  }

  get albedoView(): any { return this.textures[0]?.createView({ dimension: '2d-array' }); }
  get normalView(): any { return this.textures[1]?.createView({ dimension: '2d-array' }); }
  get heightView(): any { return this.textures[2]?.createView({ dimension: '2d-array' }); }
  get roughnessView(): any { return this.textures[3]?.createView({ dimension: '2d-array' }); }
  get materialView(): any { return this.textures[4]?.createView({ dimension: '2d-array' }); }

  /** Виділяє лише один масив за виклик, щоб не створювати довгу паузу кадру. */
  initializeStep(): boolean {
    if (this.disposed) throw new Error('Surface page cache is disposed.');
    if (this.ready) return true;
    const definitions = [
      { format: 'rgba8unorm', bytes: 4 },
      // WebGPU does not guarantee an RGB8 texture format; normals are padded to RGBA8.
      { format: 'rgba8unorm', bytes: 4 },
      { format: 'r32float', bytes: 4 },
      { format: 'r8unorm', bytes: 1 },
      { format: 'r8unorm', bytes: 1 }
    ];
    const definition = definitions[this.textures.length];
    if (!definition) return this.ready;
    const texture = this.device.createTexture({
      label: 'Cosmo-riders surface pages ' + definition.format,
      size: { width: this.pageSize, height: this.pageSize, depthOrArrayLayers: this.capacity },
      dimension: '2d',
      format: definition.format,
      mipLevelCount: 1,
      sampleCount: 1,
      usage: TEXTURE_USAGE.TEXTURE_BINDING | TEXTURE_USAGE.COPY_DST
    });
    this.textures.push(texture);
    return this.ready;
  }

  upload(tile: SurfaceTileData): number {
    if (this.disposed) throw new Error('Surface page cache is disposed.');
    if (!this.ready) throw new Error('All five WebGPU surface texture arrays must be initialized before upload.');
    if (tile.resolution + tile.gutter * 2 !== this.pageSize) throw new Error('Tile dimensions do not match the WebGPU page cache.');
    const texels = this.pageSize * this.pageSize;
    if (tile.albedo.length !== texels * 4 || tile.normal.length !== texels * 3 ||
        tile.height.length !== texels || tile.roughness.length !== texels || tile.materialId.length !== texels) {
      throw new Error('Surface tile channel lengths do not match the five WebGPU texture arrays.');
    }

    let layer = this.pages.get(tile.key);
    const isNew = layer === undefined;
    if (isNew) {
      layer = this.slots.findIndex(slot => slot.key === null);
      if (layer < 0) {
        let oldest = Infinity;
        layer = -1;
        for (let index = 0; index < this.slots.length; index++) {
          const slot = this.slots[index];
          const pinCount = slot.key ? this.pins.get(slot.key) ?? 0 : 0;
          if (pinCount === 0 && slot.used < oldest) { oldest = slot.used; layer = index; }
        }
      }
      if (layer < 0) throw new Error('All WebGPU surface page layers are pinned by visible tiles.');
    }

    const normalRgba = new Uint8Array(texels * 4);
    for (let index = 0; index < texels; index++) {
      normalRgba[index * 4] = tile.normal[index * 3];
      normalRgba[index * 4 + 1] = tile.normal[index * 3 + 1];
      normalRgba[index * 4 + 2] = tile.normal[index * 3 + 2];
      normalRgba[index * 4 + 3] = 255;
    }
    const heightBytes = new Uint8Array(tile.height.buffer, tile.height.byteOffset, tile.height.byteLength);
    const channels: Array<{ data: Uint8Array; bytesPerPixel: number }> = [
      { data: tile.albedo, bytesPerPixel: 4 },
      { data: normalRgba, bytesPerPixel: 4 },
      { data: heightBytes, bytesPerPixel: 4 },
      { data: tile.roughness, bytesPerPixel: 1 },
      { data: tile.materialId, bytesPerPixel: 1 }
    ];

    try {
      for (let index = 0; index < channels.length; index++) {
        const channel = channels[index];
        const bytesPerRow = align(this.pageSize * channel.bytesPerPixel, COPY_ROW_ALIGNMENT);
        const data = packRows(channel.data, this.pageSize, channel.bytesPerPixel, bytesPerRow);
        this.device.queue.writeTexture(
          { texture: this.textures[index], origin: { x: 0, y: 0, z: layer } },
          data,
          { offset: 0, bytesPerRow, rowsPerImage: this.pageSize },
          { width: this.pageSize, height: this.pageSize, depthOrArrayLayers: 1 }
        );
      }
    } catch (error) {
      this.uploadFailureCountValue++;
      const slot = this.slots[layer];
      if (slot.key) {
        this.pages.delete(slot.key);
        this.pins.delete(slot.key);
        this.evictionCountValue++;
      }
      slot.key = null;
      slot.used = 0;
      throw error;
    }

    if (isNew) {
      const previous = this.slots[layer].key;
      if (previous) { this.pages.delete(previous); this.pins.delete(previous); this.evictionCountValue++; }
      this.slots[layer].key = tile.key;
      this.pages.set(tile.key, layer);
    }
    this.slots[layer].used = ++this.clock;
    this.uploadCountValue++;
    this.highWaterResidentPagesValue = Math.max(this.highWaterResidentPagesValue, this.pages.size);
    return layer;
  }

  getLayer(key: string): number | undefined {
    const layer = this.pages.get(key);
    if (layer !== undefined) { this.cacheHitCountValue++; this.slots[layer].used = ++this.clock; }
    else this.cacheMissCountValue++;
    return layer;
  }

  pin(key: string): boolean {
    if (!this.pages.has(key)) return false;
    this.pins.set(key, (this.pins.get(key) ?? 0) + 1);
    return true;
  }

  unpin(key: string): void {
    const count = this.pins.get(key) ?? 0;
    if (count <= 1) this.pins.delete(key);
    else this.pins.set(key, count - 1);
  }

  isPinned(key: string): boolean { return (this.pins.get(key) ?? 0) > 0; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.textures) texture.destroy?.();
    this.textures.length = 0;
    this.pages.clear();
    this.pins.clear();
    for (const slot of this.slots) { slot.key = null; slot.used = 0; }
  }
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function packRows(source: Uint8Array, width: number, bytesPerPixel: number, bytesPerRow: number): Uint8Array {
  const sourceBytesPerRow = width * bytesPerPixel;
  if (bytesPerRow === sourceBytesPerRow) return source;
  const target = new Uint8Array(bytesPerRow * width);
  for (let row = 0; row < width; row++) {
    target.set(source.subarray(row * sourceBytesPerRow, (row + 1) * sourceBytesPerRow), row * bytesPerRow);
  }
  return target;
}
