import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCameraClipPlanes, createPerspectiveMatrix } from '../src/presentation/solar-3d.ts';

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
 assert.ok(near>0);
 assert.equal(far,100);
});

test('unfocused system-map camera retains the wide solar-system far plane',()=>{
 const [near,far]=calculateCameraClipPlanes(1,0);
 assert.ok(near>0);
 assert.equal(far,100);
});


test('WebGPU projection maps the near and far clip planes to depth zero and one', () => {
 const near=.001,far=100;
 const projection=createPerspectiveMatrix(Math.PI/3,16/9,near,far);
 const depthAt=(distance:number)=>(projection[10]*-distance+projection[14])/distance;
 assert.ok(Math.abs(depthAt(near))<1e-12,'near plane maps to WebGPU NDC z=0');
 assert.ok(Math.abs(depthAt(far)-1)<1e-12,'far plane maps to WebGPU NDC z=1');
 const middle=depthAt(Math.sqrt(near*far));
 assert.ok(middle>0&&middle<1,'interior geometry remains inside WebGPU depth range');
 assert.throws(()=>createPerspectiveMatrix(Math.PI/3,1,0,100),/clip planes/);
});
