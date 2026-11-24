import type{Disposable}from'./render-types.ts';
export interface RenderTargetOptions{width:number;height:number;depth?:boolean;linear?:boolean;hdr?:boolean;}
export class RenderTarget implements Disposable{
 readonly framebuffer:WebGLFramebuffer;readonly colorTexture:WebGLTexture;readonly depthBuffer:WebGLRenderbuffer|null;readonly hdr:boolean;width:number;height:number;
 constructor(private gl:WebGLRenderingContext|WebGL2RenderingContext,o:RenderTargetOptions){
  const f=gl.createFramebuffer(),t=gl.createTexture();if(!f||!t)throw Error('Render target allocation failed');
  const webgl2=typeof (gl as WebGL2RenderingContext).texStorage2D==='function';
  const floatColor=Boolean(o.hdr&&webgl2&&gl.getExtension('EXT_color_buffer_float'));
  if(o.hdr&&!floatColor)throw Error('HDR render targets require WebGL2 EXT_color_buffer_float support');
  this.hdr=floatColor;this.framebuffer=f;this.colorTexture=t;this.width=o.width;this.height=o.height;
  gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,o.linear===false?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,o.linear===false?gl.NEAREST:gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const g2=gl as WebGL2RenderingContext;
  if(floatColor)gl.texImage2D(gl.TEXTURE_2D,0,g2.RGBA16F,o.width,o.height,0,gl.RGBA,g2.HALF_FLOAT,null);
  else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,o.width,o.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
  let d:WebGLRenderbuffer|null=null;if(o.depth!==false){d=gl.createRenderbuffer();if(!d)throw Error('Depth buffer allocation failed');gl.bindRenderbuffer(gl.RENDERBUFFER,d);if(webgl2)(gl as WebGL2RenderingContext).renderbufferStorage(gl.RENDERBUFFER,(gl as WebGL2RenderingContext).DEPTH_COMPONENT24,o.width,o.height);else gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,o.width,o.height);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,d);}this.depthBuffer=d;
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Framebuffer incomplete');gl.bindFramebuffer(gl.FRAMEBUFFER,null);
 }
 resize(w:number,h:number){if(w===this.width&&h===this.height)return;this.width=w;this.height=h;const g=this.gl;g.bindTexture(g.TEXTURE_2D,this.colorTexture);const g2=g as WebGL2RenderingContext;if(this.hdr)g.texImage2D(g.TEXTURE_2D,0,g2.RGBA16F,w,h,0,g.RGBA,g2.HALF_FLOAT,null);else g.texImage2D(g.TEXTURE_2D,0,g.RGBA,w,h,0,g.RGBA,g.UNSIGNED_BYTE,null);if(this.depthBuffer){g.bindRenderbuffer(g.RENDERBUFFER,this.depthBuffer);if(typeof g2.texStorage2D==='function')g2.renderbufferStorage(g.RENDERBUFFER,g2.DEPTH_COMPONENT24,w,h);else g.renderbufferStorage(g.RENDERBUFFER,g.DEPTH_COMPONENT16,w,h);}g.bindTexture(g.TEXTURE_2D,null);}
 bind(){this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,this.framebuffer);this.gl.viewport(0,0,this.width,this.height);}
 unbind(){this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);}
 dispose(){this.gl.deleteFramebuffer(this.framebuffer);this.gl.deleteTexture(this.colorTexture);if(this.depthBuffer)this.gl.deleteRenderbuffer(this.depthBuffer);}
}
