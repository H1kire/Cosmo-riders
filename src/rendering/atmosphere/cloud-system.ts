/**
 * Параметри шарів хмар у фізичних одиницях та нормалізованих коефіцієнтах.
 */
export interface CloudLayer {
  id: string;
  altitudeM: number;
  coverage: number;
  opacity: number;
  wind: [number, number];
  scale: number;
  thicknessM?: number;
  detail?: number;
  erosion?: number;
  banding?: number;
}

export function normalizeCloudLayer(layer: CloudLayer): CloudLayer {
  if (!Number.isFinite(layer.altitudeM) || layer.altitudeM < 0) {
    throw new RangeError('Cloud altitude must be a finite non-negative value.');
  }
  if (!Number.isFinite(layer.scale) || layer.scale <= 0) {
    throw new RangeError('Cloud scale must be a positive finite value.');
  }
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  return {
    ...layer,
    coverage: clamp(layer.coverage, 0.02, 0.98),
    opacity: clamp(layer.opacity, 0, 1),
    wind: [clamp(layer.wind[0], -0.02, 0.02), clamp(layer.wind[1], -0.02, 0.02)],
    thicknessM: clamp(layer.thicknessM ?? Math.max(1000, layer.altitudeM * 0.22), 100, Math.max(100, layer.altitudeM || 100000)),
    detail: clamp(layer.detail ?? 3, 1, 6),
    erosion: clamp(layer.erosion ?? 0.45, 0, 1),
    banding: clamp(layer.banding ?? 0, 0, 1)
  };
}

export class CloudSystem {
  private layers = new Map<string, CloudLayer[]>();

  setLayers(bodyId: string, layers: CloudLayer[]): void {
    this.layers.set(bodyId, layers.map(normalizeCloudLayer));
  }

  getLayers(bodyId: string): CloudLayer[] {
    return (this.layers.get(bodyId) ?? []).map(layer => ({ ...layer, wind: [...layer.wind] as [number, number] }));
  }

  removeBody(bodyId: string): void {
    this.layers.delete(bodyId);
  }
}
