import type { Disposable } from './render-types.ts';

const VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
const BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;uniform sampler2D uScene;uniform float uThreshold;out vec4 outColor;
void main(){vec3 c=texture(uScene,vUv).rgb;float l=max(max(c.r,c.g),c.b);float contribution=max(l-uThreshold,0.0)/max(l,0.0001);outColor=vec4(c*contribution,1.0);}`;
const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;uniform sampler2D uInput;uniform vec2 uTexel;uniform vec2 uDirection;out vec4 outColor;
void main(){vec3 c=texture(uInput,vUv).rgb*0.227027;c+=texture(uInput,vUv+uDirection*uTexel*1.384615).rgb*0.316216;c+=texture(uInput,vUv-uDirection*uTexel*1.384615).rgb*0.316216;c+=texture(uInput,vUv+uDirection*uTexel*3.230769).rgb*0.070270;c+=texture(uInput,vUv-uDirection*uTexel*3.230769).rgb*0.070270;outColor=vec4(c,1.0);}`;
const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;uniform sampler2D uScene;uniform sampler2D uBloom;uniform float uBloomStrength;uniform float uExposure;uniform int uToneMap;out vec4 outColor;
vec3 aces(vec3 x){const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);}
void main(){vec3 hdr=texture(uScene,vUv).rgb+texture(uBloom,vUv).rgb*uBloomStrength;hdr*=uExposure;vec3 mapped=uToneMap==0?hdr/(vec3(1.0)+hdr):aces(hdr);mapped=pow(max(mapped,vec3(0.0)),vec3(1.0/2.2));outColor=vec4(mapped,1.0);}`;

interface Target { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width:number; height:number; }
function target(gl:WebGL2RenderingContext,w:number,h:number,hdr:boolean,depth=false):Target{
 const framebuffer=gl.createFramebuffer(),texture=gl.createTexture();if(!framebuffer||!texture)throw Error('HDR render target allocation failed');
 gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texImage2D(gl.TEXTURE_2D,0,hdr?gl.RGBA16F:gl.RGBA8,w,h,0,gl.RGBA,hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
 gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
 if(depth){const d=gl.createRenderbuffer();if(!d)throw Error('Depth buffer allocation failed');gl.bindRenderbuffer(gl.RENDERBUFFER,d);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,d);}
 if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);throw Error('HDR framebuffer incomplete');}
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);return{framebuffer,texture,width:w,height:h};
}
function program(gl:WebGL2RenderingContext,fs:string){const v=gl.createShader(gl.VERTEX_SHADER)!,f=gl.createShader(gl.FRAGMENT_SHADER)!,p=gl.createProgram()!;gl.shaderSource(v,VERTEX);gl.compileShader(v);gl.shaderSource(f,fs);gl.compileShader(f);if(!gl.getShaderParameter(v,gl.COMPILE_STATUS)||!gl.getShaderParameter(f,gl.COMPILE_STATUS))throw Error('Post-processing shader compile failed: '+gl.getShaderInfoLog(v)+' '+gl.getShaderInfoLog(f));gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error('Post-processing shader link failed: '+gl.getProgramInfoLog(p));return p;}

export interface HDRPipelineSettings { bloom:boolean; bloomThreshold:number; bloomStrength:number; exposure:number; toneMapping:'reinhard'|'aces'; }
export class HDRPipeline implements Disposable{
 readonly hdrSupported:boolean;
 readonly scene:Target;private bright:Target;private ping:Target;private pong:Target;
 private brightProgram:WebGLProgram;private blurProgram:WebGLProgram;private compositeProgram:WebGLProgram;
 settings:HDRPipelineSettings={bloom:true,bloomThreshold:1.15,bloomStrength:.72,exposure:1,toneMapping:'aces'};
 constructor(private gl:WebGL2RenderingContext,width:number,height:number){
  this.hdrSupported=Boolean(gl.getExtension('EXT_color_buffer_float'));
  this.scene=target(gl,width,height,this.hdrSupported,true);
  const bw=Math.max(1,Math.floor(width*.5)),bh=Math.max(1,Math.floor(height*.5));
  this.bright=target(gl,bw,bh,this.hdrSupported);this.ping=target(gl,bw,bh,this.hdrSupported);this.pong=target(gl,bw,bh,this.hdrSupported);
  this.brightProgram=program(gl,BRIGHT);this.blurProgram=program(gl,BLUR);this.compositeProgram=program(gl,COMPOSITE);
 }
 begin(width:number,height:number){this.resize(width,height);const g=this.gl;g.bindFramebuffer(g.FRAMEBUFFER,this.scene.framebuffer);g.viewport(0,0,this.scene.width,this.scene.height);g.clearColor(.008,.016,.033,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);}
 resize(width:number,height:number){if(width===this.scene.width&&height===this.scene.height)return;this.destroyTargets();const a=target(this.gl,width,height,this.hdrSupported,true),s=Math.max(1,Math.floor(width*.5)),t=Math.max(1,Math.floor(height*.5));this.scene.framebuffer=a.framebuffer;this.scene.texture=a.texture;this.scene.width=width;this.scene.height=height;this.bright=target(this.gl,s,t,this.hdrSupported);this.ping=target(this.gl,s,t,this.hdrSupported);this.pong=target(this.gl,s,t,this.hdrSupported);}
 private destroyTargets(){const g=this.gl;for(const t of [this.scene,this.bright,this.ping,this.pong]){g.deleteFramebuffer(t.framebuffer);g.deleteTexture(t.texture);}}
 private draw(program:WebGLProgram){const g=this.gl;g.useProgram(program);g.drawArrays(g.TRIANGLES,0,3);}
 present(width:number,height:number){const g=this.gl;g.disable(g.DEPTH_TEST);g.disable(g.BLEND);
  if(this.settings.bloom){g.bindFramebuffer(g.FRAMEBUFFER,this.bright.framebuffer);g.viewport(0,0,this.bright.width,this.bright.height);g.useProgram(this.brightProgram);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.scene.texture);g.uniform1i(g.getUniformLocation(this.brightProgram,'uScene'),0);g.uniform1f(g.getUniformLocation(this.brightProgram,'uThreshold'),this.settings.bloomThreshold);g.drawArrays(g.TRIANGLES,0,3);
   let input=this.bright;for(let i=0;i<4;i++){const output=i%2===0?this.ping:this.pong;g.bindFramebuffer(g.FRAMEBUFFER,output.framebuffer);g.viewport(0,0,output.width,output.height);g.useProgram(this.blurProgram);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,input.texture);g.uniform1i(g.getUniformLocation(this.blurProgram,'uInput'),0);g.uniform2f(g.getUniformLocation(this.blurProgram,'uTexel'),1/input.width,1/input.height);g.uniform2f(g.getUniformLocation(this.blurProgram,'uDirection'),i%2===0?1:0,i%2===0?0:1);g.drawArrays(g.TRIANGLES,0,3);input=output;}
   g.bindFramebuffer(g.FRAMEBUFFER,null);g.viewport(0,0,width,height);g.useProgram(this.compositeProgram);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.scene.texture);g.uniform1i(g.getUniformLocation(this.compositeProgram,'uScene'),0);g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,input.texture);g.uniform1i(g.getUniformLocation(this.compositeProgram,'uBloom'),1);
  }else{g.bindFramebuffer(g.FRAMEBUFFER,null);g.viewport(0,0,width,height);g.useProgram(this.compositeProgram);g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.scene.texture);g.uniform1i(g.getUniformLocation(this.compositeProgram,'uScene'),0);g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,this.scene.texture);g.uniform1i(g.getUniformLocation(this.compositeProgram,'uBloom'),1);}
  g.uniform1f(g.getUniformLocation(this.compositeProgram,'uBloomStrength'),this.settings.bloom?this.settings.bloomStrength:0);g.uniform1f(g.getUniformLocation(this.compositeProgram,'uExposure'),this.settings.exposure);g.uniform1i(g.getUniformLocation(this.compositeProgram,'uToneMap'),this.settings.toneMapping==='reinhard'?0:1);this.draw(this.compositeProgram);g.enable(g.DEPTH_TEST);g.bindFramebuffer(g.FRAMEBUFFER,null);
 }
 dispose(){this.destroyTargets();const g=this.gl;g.deleteProgram(this.brightProgram);g.deleteProgram(this.blurProgram);g.deleteProgram(this.compositeProgram);}
}
