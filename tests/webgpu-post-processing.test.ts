import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveBloomIterations } from '../src/rendering/webgpu/post-processing.ts';

test('Bloom iteration setting is clamped to a safe bounded range',()=>{
 assert.equal(resolveBloomIterations(undefined),3);
 assert.equal(resolveBloomIterations(1),1);
 assert.equal(resolveBloomIterations(4),4);
 assert.equal(resolveBloomIterations(8.9),8);
 assert.equal(resolveBloomIterations(0),1);
 assert.equal(resolveBloomIterations(-5),1);
 assert.equal(resolveBloomIterations(40),8);
 assert.equal(resolveBloomIterations(Number.NaN),3);
});

test('WebGPU bloom performs soft-knee luminance extraction and repeated separable blur',async()=>{
 const backend=await readFile(new URL('../src/rendering/webgpu/webgpu-backend.ts',import.meta.url),'utf8');
 assert.match(backend,/format:'rgba16float'/);
 assert.match(backend,/dot\(c,vec3<f32>\(0\.2126,0\.7152,0\.0722\)\)/);
 assert.match(backend,/let knee=max\(threshold\*0\.5,0\.0001\)/);
 assert.match(backend,/let soft=clamp\(/);
 assert.match(backend,/write\(1,1\/bloomWidth,0\)/);
 assert.match(backend,/write\(2,0,1\/bloomHeight\)/);
 assert.match(backend,/for\(let iteration=1;iteration<iterations;iteration\+\+\)/);
 assert.match(backend,/this\.postGroups\.length!==5/);
 assert.match(backend,/draw\(this\.context\.getCurrentTexture\(\),this\.postPipelines\.composite/);
});

test('Solar scene forwards active graphics profile into WebGPU HDR and Bloom',async()=>{
 const solar=await readFile(new URL('../src/presentation/solar-3d.ts',import.meta.url),'utf8');
 assert.match(solar,/postProcessing:\{bloom:this\.graphics\.bloom/);
 assert.match(solar,/bloomIterations:this\.graphics\.bloomIterations/);
 assert.match(solar,/exposure:this\.graphics\.exposure/);
 assert.match(solar,/hdr:this\.graphics\.hdr/);
 assert.match(solar,/toneMapping:this\.graphics\.hdr\?'aces':'reinhard'/);
});
