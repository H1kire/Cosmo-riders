import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality } from '../src/rendering/quality/adaptive-quality.ts';
import { createGraphicsSettings } from '../src/rendering/quality/quality-settings.ts';

test('adaptive quality steps down after sustained slow frames and recovers after sustained headroom',()=>{
 const adaptive=new AdaptiveQuality('ultra',16.67);
 let level:'low'|'medium'|'high'|'ultra'='ultra';
 for(let i=0;i<30;i++)level=adaptive.addFrameTime(30);
 assert.equal(level,'high');
 for(let i=0;i<30;i++)level=adaptive.addFrameTime(30);
 assert.equal(level,'medium');
 for(let i=0;i<30;i++)level=adaptive.addFrameTime(8);
 assert.equal(level,'high');
 for(let i=0;i<30;i++)level=adaptive.addFrameTime(8);
 assert.equal(level,'ultra');
});

test('all graphics presets enable optional adaptive quality by default',()=>{
 for(const preset of ['low','medium','high','ultra'] as const)assert.equal(createGraphicsSettings(preset).adaptiveQuality,true);
});
