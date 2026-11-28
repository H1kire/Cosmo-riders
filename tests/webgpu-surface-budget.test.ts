import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvailableSurfacePageBudget } from '../src/rendering/webgpu/webgpu-geodesic-surface-system.ts';

test('shared WebGPU surface cache reserves 20 root pages for every later visible solid body', () => {
  assert.equal(resolveAvailableSurfacePageBudget(256, 0, 7), 116);
  assert.equal(resolveAvailableSurfacePageBudget(256, 116, 6), 20);
  assert.equal(resolveAvailableSurfacePageBudget(256, 236, 0), 20);
  assert.equal(resolveAvailableSurfacePageBudget(256, 256, 0), 0);
});

test('surface page reservation clamps invalid and fractional budget inputs safely', () => {
  assert.equal(resolveAvailableSurfacePageBudget(256, 12.9, 2.8), 204);
  assert.equal(resolveAvailableSurfacePageBudget(256, -10, -1), 256);
  assert.equal(resolveAvailableSurfacePageBudget(256, 999, 1), 0);
  assert.equal(resolveAvailableSurfacePageBudget(Number.NaN, 0, 0), 0);
  assert.equal(resolveAvailableSurfacePageBudget(256, 0, 2, 0), 254);
});
