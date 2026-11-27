import test from 'node:test';
import assert from 'node:assert/strict';
import {
  atmosphereScaleHeightRatio,
  exponentialDensity,
  miePhase,
  rayleighPhase,
  WEBGPU_ATMOSPHERE_WGSL
} from '../src/rendering/webgpu/atmosphere-scattering.ts';

test('Rayleigh phase is wavelength-independent and symmetric around 90 degrees', () => {
  assert.ok(rayleighPhase(1) > rayleighPhase(0));
  assert.equal(rayleighPhase(-0.4), rayleighPhase(0.4));
  assert.ok(Number.isFinite(rayleighPhase(0)));
});

test('Mie phase remains finite and strongly forward-scattering for positive anisotropy', () => {
  const forward = miePhase(1, 0.76);
  const backward = miePhase(-1, 0.76);
  assert.ok(Number.isFinite(forward) && Number.isFinite(backward));
  assert.ok(forward > backward);
  assert.ok(Number.isFinite(miePhase(1, 4)));
});

test('Exponential atmosphere density and scale-height ratios are bounded', () => {
  assert.equal(exponentialDensity(0, 8000), 1);
  assert.ok(exponentialDensity(8000, 8000) < 0.4);
  assert.equal(exponentialDensity(-10, 8000), 1);
  assert.equal(atmosphereScaleHeightRatio(8000, 6_371_000), 8000 / 6_371_000);
  assert.throws(() => atmosphereScaleHeightRatio(0, 6_371_000), RangeError);
});

test('Active WebGPU WGSL includes view and solar optical-depth integration', () => {
  assert.match(WEBGPU_ATMOSPHERE_WGSL, /raySphereInterval/);
  assert.match(WEBGPU_ATMOSPHERE_WGSL, /sunDepthR/);
  assert.match(WEBGPU_ATMOSPHERE_WGSL, /sunDepthM/);
  assert.match(WEBGPU_ATMOSPHERE_WGSL, /surfaceShadowVisibility/);
  assert.match(WEBGPU_ATMOSPHERE_WGSL, /miePhase/);
  assert.match(WEBGPU_ATMOSPHERE_WGSL, /rayleighPhase/);
});
