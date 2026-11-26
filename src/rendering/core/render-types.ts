export type Vec3 = readonly [number, number, number];
export type Color3 = readonly [number, number, number];
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export interface Disposable { dispose(): void; }

/** A single immutable snapshot of the simulation and camera for one GPU frame. */
export interface RenderFrameContext {
  readonly device: any;
  readonly queue: any;
  readonly encoder: any;
  readonly colorView: any;
  readonly depthView: any;
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly timeSeconds: number;
  readonly deltaSeconds: number;
  readonly cameraPosition: Vec3;
  readonly viewProjection: Float32Array;
  readonly scene: unknown;
}

/** A render pass records commands into the shared frame encoder.
 * Optional legacy hooks keep incremental migration type-safe.
 */
export interface RenderPass {
  readonly name: string;
  readonly order: number;
  enabled: boolean;
  encode?(context: RenderFrameContext): void;
  render?(context: RenderFrameContext): void;
  dispose?(): void;
  onDeviceRestored?(device: any): void | Promise<void>;
}

export interface RenderEngineOptions {
  readonly pixelRatioCap?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly alphaMode?: 'opaque' | 'premultiplied';
  readonly onDeviceLost?: (reason: string) => void;
  readonly onError?: (error: Error) => void;
}
