import test from 'node:test';
import assert from 'node:assert/strict';
import { planetaryDisplayGain, solarIrradianceForDisplay } from '../src/rendering/lighting/lighting-system.ts';

test('solar display irradiance preserves inverse-square falloff with bounded distant-body compensation',()=>{
 assert.equal(solarIrradianceForDisplay(1),1);
 assert.ok(solarIrradianceForDisplay(0.387)>1,'inner planets receive greater solar irradiance');
 assert.ok(solarIrradianceForDisplay(5.2)<1,'Jupiter receives less solar irradiance than Earth');
 assert.ok(solarIrradianceForDisplay(30.1)<solarIrradianceForDisplay(5.2),'Neptune receives less irradiance than Jupiter');
 assert.ok(solarIrradianceForDisplay(30.1)>0,'distant planets retain non-zero illumination');
 assert.equal(solarIrradianceForDisplay(0),1);
 assert.ok(planetaryDisplayGain(30.1)<=64);
});
