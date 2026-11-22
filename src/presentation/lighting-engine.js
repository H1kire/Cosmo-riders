/** Простая расширяемая система источников света для 3D-сцены. */
export class LightingEngine {
  constructor() { this.pointLights = new Map(); }
  setPointLight(id, position, options = {}) {
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) {
      throw new TypeError('Позиция источника света должна содержать три конечные координаты.');
    }
    this.pointLights.set(id, {
      position: [...position],
      intensity: Number.isFinite(options.intensity) ? Math.max(0, options.intensity) : 1,
      color: Array.isArray(options.color) ? [...options.color] : [1, 1, 1]
    });
  }
  removeLight(id) { this.pointLights.delete(id); }
  getLight(id) { return this.pointLights.get(id) ?? null; }
  directionAt(point, id) {
    const light = this.pointLights.get(id);
    if (!light) return [0, 0, 1];
    const dx = light.position[0] - point[0];
    const dy = light.position[1] - point[1];
    const dz = light.position[2] - point[2];
    const length = Math.hypot(dx, dy, dz) || 1;
    return [dx / length, dy / length, dz / length];
  }
  colorAt(id) {
    const light = this.pointLights.get(id);
    return light ? [...light.color] : [0, 0, 0];
  }
  intensityAt(point, id) {
    const light = this.pointLights.get(id);
    if (!light) return 0;
    const dx = light.position[0] - point[0];
    const dy = light.position[1] - point[1];
    const dz = light.position[2] - point[2];
    return light.intensity / Math.max(1, dx * dx + dy * dy + dz * dz);
  }
}
