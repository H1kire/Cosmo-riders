import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCameraClipPlanes } from '../src/presentation/solar-3d.ts';

const AU=149_597_870_700;

test('focused planetary camera keeps near plane below close surface clearance',()=>{
 const radius=6_371_000/AU,altitude=10_000/AU;
 const [near,far]=calculateCameraClipPlanes(radius+altitude,radius);
 assert.ok(near<altitude*.1+1e-15);
 assert.ok(near<radius);
 assert.ok(far>radius+altitude);
 assert.ok(far>384_400_000/AU,'focused Earth view retains the Moon inside the far plane');
 assert.equal(far,100,'focused views preserve the complete solar-system range');
});

test('focused camera adapts near plane while preserving the 100 AU scene range',()=>{
 const [near,far]=calculateCameraClipPlanes(1,6_371_000/AU);
 assert.ok(near>0);
 assert.ok(near<6_371_000/AU);
 assert.equal(far,100);
});

test('unfocused system-map camera retains the wide solar-system far plane',()=>{
 const [near,far]=calculateCameraClipPlanes(1,0);
 assert.ok(near>0);
 assert.equal(far,100);
});
