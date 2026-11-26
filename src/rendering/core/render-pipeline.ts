import type { RenderFrameContext, RenderPass } from './render-types.ts';

/** Orders all scene and post-processing passes inside one command encoder. */
export class RenderPipeline {
  private readonly passes: RenderPass[] = [];
  private disposed = false;

  add(pass: RenderPass): this {
    if (this.disposed) throw new Error('RenderPipeline is disposed.');
    if (this.passes.some(item => item.name === pass.name)) {
      throw new Error('Duplicate render pass: ' + pass.name);
    }
    this.passes.push(pass);
    this.passes.sort((a, b) => a.order - b.order);
    return this;
  }

  remove(name: string): boolean {
    const index = this.passes.findIndex(pass => pass.name === name);
    if (index < 0) return false;
    this.passes[index].dispose();
    this.passes.splice(index, 1);
    return true;
  }

  getPasses(): readonly RenderPass[] { return this.passes.slice(); }

  /**
   * Records every enabled pass in priority order.
   * The render() branch keeps the pre-WebGPU pass contract working while
   * existing renderers are migrated to encoder-based encode() implementations.
   */
  encode(context: RenderFrameContext): void {
    if (this.disposed) throw new Error('RenderPipeline is disposed.');
    for (const pass of this.passes) {
      if (!pass.enabled) continue;
      if (typeof pass.encode === 'function') {
        pass.encode(context);
      } else {
        const legacyPass = pass as RenderPass & { render?: (frame: RenderFrameContext) => void };
        if (typeof legacyPass.render === 'function') legacyPass.render(context);
      }
    }
  }

  /** Backward-compatible entry point used by the existing rendering tests. */
  render(context: RenderFrameContext): void {
    this.encode(context);
  }

  async restore(device: any): Promise<void> {
    for (const pass of this.passes) await pass.onDeviceRestored?.(device);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pass of this.passes) pass.dispose();
    this.passes.length = 0;
  }
}
