export interface WasmSurfaceTileArrays {
  readonly albedo: Uint8Array;
  readonly normal: Uint8Array;
  readonly height: Float32Array;
  readonly roughness: Uint8Array;
  readonly materialId: Uint8Array;
  readonly resolution: number;
  readonly gutter: number;
}

export interface WasmGeodesicMeshArrays {
  readonly tileKey: string;
  readonly resolution: number;
  readonly radiusM: number;
  readonly directions: Float32Array;
  readonly positionsM: Float32Array;
  readonly normals: Float32Array;
  readonly textureCoordinates: Float32Array;
  readonly indices: Uint32Array;
}

export interface WasmPropagationSnapshot {
  readonly position: Float64Array;
  readonly velocity: Float64Array;
  readonly iterations: number;
}
