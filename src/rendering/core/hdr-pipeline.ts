import type { Disposable } from './render-types.ts';

const VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
  vUv=p;
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;

const BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
out vec4 outColor;
void main(){
  vec3 c=texture(uScene,vUv).rgb;
  float l=max(max(c.r,c.g),c.b);
  float contribution=max(l-uThreshold,0.0)/max(l,0.0001);
  outColor=vec4(c*contribution,1.0);
}`;

const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInput;
uniform vec2 uTexel;
uniform vec2 uDirection;
out vec4 outColor;
void main(){
  vec3 c=texture(uInput,vUv).rgb*0.227027;
  c+=texture(uInput,vUv+uDirection*uTexel*1.384615).rgb*0.316216;
  c+=texture(uInput,vUv-uDirection*uTexel*1.384615).rgb*0.316216;
  c+=texture(uInput,vUv+uDirection*uTexel*3.230769).rgb*0.070270;
  c+=texture(uInput,vUv-uDirection*uTexel*3.230769).rgb*0.070270;
  outColor=vec4(c,1.0);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform int uToneMap;
uniform int uHdrEnabled;
uniform int uGlareEnabled;
uniform int uLensFlareEnabled;
uniform float uGlareStrength;
uniform float uLensFlareStrength;
uniform vec2 uSunUv;
uniform float uSunVisible;
out vec4 outColor;
vec3 aces(vec3 x){
  const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0);
}
float halo(vec2 uv,vec2 center,float scale){
  vec2 d=uv-center;
  return exp(-dot(d,d)*scale);
}
void main(){
  vec3 hdr=texture(uScene,vUv).rgb+texture(uBloom,vUv).rgb*uBloomStrength;
  vec2 d=vUv-uSunUv;
  float r=length(d);
  if(uGlareEnabled==1&&uSunVisible>0.0){
    float angle=atan(d.y,d.x);
    float rays=pow(abs(cos(angle*4.0)),28.0)*exp(-r*17.0);
    float crossStreak=(exp(-abs(d.x)*420.0)+exp(-abs(d.y)*420.0))*exp(-r*12.0);
    float core=halo(vUv,uSunUv,2600.0);
    float glare=(rays*0.32+crossStreak*0.12+core*0.75)*uGlareStrength*uSunVisible;
    hdr+=vec3(1.0,0.79,0.53)*glare;
  }
  if(uLensFlareEnabled==1&&uSunVisible>0.0){
    vec2 axis=vec2(0.5)-uSunUv;
    vec2 p1=uSunUv+axis*0.48;
    vec2 p2=uSunUv+axis*0.92;
    vec2 p3=uSunUv-axis*0.32;
    float ghosts=halo(vUv,p1,620.0)*0.48+halo(vUv,p2,1050.0)*0.34+halo(vUv,p3,1500.0)*0.22;
    float anamorphic=exp(-abs(vUv.y-uSunUv.y)*760.0)*exp(-abs(vUv.x-uSunUv.x)*8.0);
    hdr+=vec3(0.48,0.68,1.0)*(ghosts+anamorphic*0.12)*uLensFlareStrength*uSunVisible;
  }
  hdr*=uExposure;
  vec3 mapped;
  if(uHdrEnabled==0)mapped=clamp(hdr,0.0,1.0);
  else mapped=uToneMap==0?hdr/(vec3(1.0)+hdr):aces(hdr);
  mapped=pow(max(mapped,vec3(0.0)),vec3(1.0/2.2));
  outColor=vec4(mapped,1.0);
}`;

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  depthBuffer: WebGLRenderbuffer|null;
  width: number;
  height: number;
}

function target(gl:WebGL2RenderingContext,w:number,h:number,hdr:boolean,depth=false):Target{
  const framebuffer=gl.createFramebuffer(),texture=gl.createTexture();
  if(!framebuffer||!texture)throw Error('HDR render target allocation failed');
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D,0,hdr?gl.RGBA16F:gl.RGBA8,w,h,0,gl.RGBA,hdr?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  let depthBuffer:WebGLRenderbuffer|null=null;
  if(depth){
    depthBuffer=gl.createRenderbuffer();
    if(!depthBuffer)throw Error('Depth buffer allocation failed');
    gl.bindRenderbuffer(gl.RENDERBUFFER,depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,w,h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depthBuffer);
  }
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){
    gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);
    if(depthBuffer)gl.deleteRenderbuffer(depthBuffer);
    throw Error('HDR framebuffer incomplete');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  return{framebuffer,texture,depthBuffer,width:w,height:h};
}

function program(gl:WebGL2RenderingContext,fs:string){
  const v=gl.createShader(gl.VERTEX_SHADER),f=gl.createShader(gl.FRAGMENT_SHADER),p=gl.createProgram();
  if(!v||!f||!p)throw Error('Post-processing GPU allocation failed');
  gl.shaderSource(v,VERTEX);gl.compileShader(v);
  gl.shaderSource(f,fs);gl.compileShader(f);
  if(!gl.getShaderParameter(v,gl.COMPILE_STATUS)||!gl.getShaderParameter(f,gl.COMPILE_STATUS)){
    const error=gl.getShaderInfoLog(v)+' '+gl.getShaderInfoLog(f);
    gl.deleteShader(v);gl.deleteShader(f);gl.deleteProgram(p);
    throw Error('Post-processing shader compile failed: '+error);
  }
  gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);
  gl.deleteShader(v);gl.deleteShader(f);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS)){
    const error=gl.getProgramInfoLog(p);gl.deleteProgram(p);
    throw Error('Post-processing shader link failed: '+error);
  }
  return p;
}

export interface HDRPipelineSettings {
  bloom:boolean;
  bloomThreshold:number;
  bloomStrength:number;
  bloomIterations:number;
  glare:boolean;
  glareStrength:number;
  lensFlare:boolean;
  lensFlareStrength:number;
  exposure:number;
  toneMapping:'reinhard'|'aces';
  hdr:boolean;
}

export class HDRPipeline implements Disposable {
  readonly hdrSupported:boolean;
  private activeHdr:boolean;
  scene:Target;
  private bright:Target;
  private ping:Target;
  private pong:Target;
  private brightProgram:WebGLProgram;
  private blurProgram:WebGLProgram;
  private compositeProgram:WebGLProgram;
  private sunUv:[number,number]=[0.5,0.5];
  private sunVisible=0;
  settings:HDRPipelineSettings={
    bloom:true,bloomThreshold:1.45,bloomStrength:0.42,bloomIterations:4,
    glare:true,glareStrength:0.28,lensFlare:true,lensFlareStrength:0.32,
    exposure:1,toneMapping:'aces',hdr:true
  };

  constructor(private gl:WebGL2RenderingContext,width:number,height:number){
    this.hdrSupported=Boolean(gl.getExtension('EXT_color_buffer_float'));
    this.activeHdr=this.hdrSupported;
    this.scene=target(gl,width,height,this.activeHdr,true);
    const bw=Math.max(1,Math.floor(width*0.5)),bh=Math.max(1,Math.floor(height*0.5));
    this.bright=target(gl,bw,bh,this.activeHdr);
    this.ping=target(gl,bw,bh,this.activeHdr);
    this.pong=target(gl,bw,bh,this.activeHdr);
    this.brightProgram=program(gl,BRIGHT);
    this.blurProgram=program(gl,BLUR);
    this.compositeProgram=program(gl,COMPOSITE);
  }

  setOpticalSource(uv:[number,number],visible:boolean):void{
    this.sunUv=[Math.max(0,Math.min(1,uv[0])),Math.max(0,Math.min(1,uv[1]))];
    this.sunVisible=visible?1:0;
  }

  begin(width:number,height:number):void{
    this.resize(width,height);
    const g=this.gl;
    g.bindFramebuffer(g.FRAMEBUFFER,this.scene.framebuffer);
    g.viewport(0,0,this.scene.width,this.scene.height);
    g.clearColor(0.008,0.016,0.033,1);
    g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);
  }

  setHDREnabled(enabled:boolean):void{
    const next=enabled&&this.hdrSupported;
    if(next===this.activeHdr)return;
    this.activeHdr=next;
    const width=this.scene.width,height=this.scene.height;
    this.destroyTargets();
    this.scene=target(this.gl,width,height,this.activeHdr,true);
    const bw=Math.max(1,Math.floor(width*0.5)),bh=Math.max(1,Math.floor(height*0.5));
    this.bright=target(this.gl,bw,bh,this.activeHdr);
    this.ping=target(this.gl,bw,bh,this.activeHdr);
    this.pong=target(this.gl,bw,bh,this.activeHdr);
  }

  resize(width:number,height:number):void{
    if(width===this.scene.width&&height===this.scene.height)return;
    this.destroyTargets();
    this.scene=target(this.gl,width,height,this.activeHdr,true);
    const bw=Math.max(1,Math.floor(width*0.5)),bh=Math.max(1,Math.floor(height*0.5));
    this.bright=target(this.gl,bw,bh,this.activeHdr);
    this.ping=target(this.gl,bw,bh,this.activeHdr);
    this.pong=target(this.gl,bw,bh,this.activeHdr);
  }

  private destroyTarget(t:Target):void{
    const g=this.gl;
    g.deleteFramebuffer(t.framebuffer);g.deleteTexture(t.texture);
    if(t.depthBuffer)g.deleteRenderbuffer(t.depthBuffer);
  }
  private destroyTargets():void{
    this.destroyTarget(this.scene);this.destroyTarget(this.bright);
    this.destroyTarget(this.ping);this.destroyTarget(this.pong);
  }

  present(width:number,height:number):void{
    const g=this.gl;
    g.disable(g.DEPTH_TEST);g.disable(g.BLEND);
    let bloomInput:Target=this.scene;
    if(this.settings.bloom){
      g.bindFramebuffer(g.FRAMEBUFFER,this.bright.framebuffer);
      g.viewport(0,0,this.bright.width,this.bright.height);
      g.useProgram(this.brightProgram);
      g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.scene.texture);
      g.uniform1i(g.getUniformLocation(this.brightProgram,'uScene'),0);
      g.uniform1f(g.getUniformLocation(this.brightProgram,'uThreshold'),this.settings.bloomThreshold);
      g.drawArrays(g.TRIANGLES,0,3);
      let input=this.bright;
      const iterations=Math.max(1,Math.min(8,Math.round(this.settings.bloomIterations)));
      for(let i=0;i<iterations;i++){
        const output=i%2===0?this.ping:this.pong;
        g.bindFramebuffer(g.FRAMEBUFFER,output.framebuffer);
        g.viewport(0,0,output.width,output.height);
        g.useProgram(this.blurProgram);
        g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,input.texture);
        g.uniform1i(g.getUniformLocation(this.blurProgram,'uInput'),0);
        g.uniform2f(g.getUniformLocation(this.blurProgram,'uTexel'),1/input.width,1/input.height);
        g.uniform2f(g.getUniformLocation(this.blurProgram,'uDirection'),i%2===0?1:0,i%2===0?0:1);
        g.drawArrays(g.TRIANGLES,0,3);
        input=output;
      }
      bloomInput=input;
    }
    g.bindFramebuffer(g.FRAMEBUFFER,null);g.viewport(0,0,width,height);
    g.useProgram(this.compositeProgram);
    g.activeTexture(g.TEXTURE0);g.bindTexture(g.TEXTURE_2D,this.scene.texture);
    g.uniform1i(g.getUniformLocation(this.compositeProgram,'uScene'),0);
    g.activeTexture(g.TEXTURE1);g.bindTexture(g.TEXTURE_2D,bloomInput.texture);
    g.uniform1i(g.getUniformLocation(this.compositeProgram,'uBloom'),1);
    const u=(name:string)=>g.getUniformLocation(this.compositeProgram,name);
    g.uniform1f(u('uBloomStrength'),this.settings.bloom?this.settings.bloomStrength:0);
    g.uniform1f(u('uExposure'),this.settings.exposure);
    g.uniform1i(u('uToneMap'),this.settings.toneMapping==='reinhard'?0:1);
    g.uniform1i(u('uHdrEnabled'),this.settings.hdr&&this.hdrSupported?1:0);
    g.uniform1i(u('uGlareEnabled'),this.settings.glare?1:0);
    g.uniform1i(u('uLensFlareEnabled'),this.settings.lensFlare?1:0);
    g.uniform1f(u('uGlareStrength'),this.settings.glareStrength);
    g.uniform1f(u('uLensFlareStrength'),this.settings.lensFlareStrength);
    g.uniform2f(u('uSunUv'),this.sunUv[0],this.sunUv[1]);
    g.uniform1f(u('uSunVisible'),this.sunVisible);
    g.drawArrays(g.TRIANGLES,0,3);
    g.enable(g.DEPTH_TEST);
    g.bindFramebuffer(g.FRAMEBUFFER,null);
  }

  dispose():void{
    this.destroyTargets();
    const g=this.gl;
    g.deleteProgram(this.brightProgram);g.deleteProgram(this.blurProgram);g.deleteProgram(this.compositeProgram);
  }
}
