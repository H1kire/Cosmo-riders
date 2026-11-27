import test from 'node:test';
import assert from 'node:assert/strict';
import { gasGiantProfileForId } from '../src/rendering/atmosphere/gas-giant-profile.ts';
import { readFile } from 'node:fs/promises';

test('gas giant profiles expose distinct bounded zonal and storm controls', () => {
  const ids = ['jupiter', 'saturn', 'uranus', 'neptune'];
  const profiles = ids.map(id => gasGiantProfileForId(id));
  assert.ok(profiles.every(Boolean));
  assert.equal(new Set(profiles.map(profile => profile!.type)).size, 4);
  for (const profile of profiles) {
    assert.ok(profile!.bandStrength >= 0 && profile!.bandStrength <= 1);
    assert.ok(profile!.stormStrength >= 0 && profile!.stormStrength <= 1);
    assert.ok(profile!.jetCount >= 1 && profile!.jetCount <= 20);
  }
  assert.equal(gasGiantProfileForId('earth'), null);
  const copy = gasGiantProfileForId('jupiter')!;
  copy.type = 99;
  assert.equal(gasGiantProfileForId('jupiter')!.type, 1);
});

test('active WebGPU shader contains direction-space gas giant bands, vortices and planet-specific storm palettes', async () => {
  const backend = await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts', import.meta.url), 'utf8');
  assert.match(backend, /fn gasStormField\(/);
  assert.match(backend, /fn gasGiantPalette\(/);
  assert.match(backend, /angularStorm\(direction, jupiterCenter/);
  assert.match(backend, /angularStorm\(direction, neptuneCenter/);
  assert.match(backend, /let hexagon = 0\.5 \+ 0\.5 \* cos\(longitude \* 6\.0/);
  assert.match(backend, /clamp\(body\.surfaceParams\.x, 1\.0, 4\.0\)/);
  assert.match(backend, /gasGiantPalette\(direction, gasType, body\.material\.y\)/);
  assert.match(backend, /body\.lightAndEmission\.z/);
});

test('Solar3DView passes gas giant identity from the live body into WebGPU', async () => {
  const solar = await readFile(new URL('../src/presentation/solar-3d.ts', import.meta.url), 'utf8');
  assert.match(solar, /gasGiant:gasGiantProfileForId\(body\.id\)\?\?undefined/);
  assert.match(solar, /gasGiantProfileForId/);
});
