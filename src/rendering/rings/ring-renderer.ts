export class RingRenderer {
 private program:WebGLProgram;
 private buffer:WebGLBuffer;
 private count:number;
 private locations:Record<string,WebGLUniformLocation|null>;
 constructor(private gl:WebGL2RenderingContext,segments=768){
  const vertex=`#version 300 es
  precision highp float;
  in vec3 aPosition;
  uniform mat4 uViewProjection;
  uniform mat4 uModel;
  out vec3 vLocalPosition;
  void main(){vLocalPosition=aPosition;gl_Position=uViewProjection*uModel*vec4(aPosition,1.0);}`;
  const fragment=`#version 300 es
  precision highp float;
  in vec3 vLocalPosition;
  uniform vec3 uColor;
  uniform float uInnerRatio;
  uniform float uOpacity;
  out vec4 outColor;
  void main(){
   float r=length(vLocalPosition.xz);
   float edge=smoothstep(uInnerRatio,uInnerRatio+0.012,r)*(1.0-smoothstep(0.985,1.0,r));
   float bands=0.72+0.16*sin(r*410.0)+0.08*sin(r*1270.0)+0.04*sin(r*2830.0);
   float division=1.0-0.82*smoothstep(0.003,0.012,abs(r-0.78));
   float alpha=uOpacity*edge*bands*division;
   if(alpha<0.012)discard;
   outColor=vec4(uColor*(0.62+0.38*bands),alpha);
  }`;
  const compile=(type:number,source:string)=>{const shader=gl.createShader(type);if(!shader)throw Error('Ring shader allocation failed');gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error('Ring shader compile failed: '+error);}return shader;};
  const vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram();
  if(!program)throw Error('Ring program allocation failed');
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw Error('Ring program link failed: '+error);}
  this.program=program;
  this.locations={aPosition:gl.getAttribLocation(program,'aPosition') as unknown as WebGLUniformLocation,uViewProjection:gl.getUniformLocation(program,'uViewProjection'),uModel:gl.getUniformLocation(program,'uModel'),uColor:gl.getUniformLocation(program,'uColor'),uInnerRatio:gl.getUniformLocation(program,'uInnerRatio'),uOpacity:gl.getUniformLocation(program,'uOpacity')};
  const vertices=new Float32Array((segments+1)*2*3);let offset=0;
  for(let i=0;i<=segments;i++){const angle=i/segments*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);vertices[offset++]=c*.55;vertices[offset++]=0;vertices[offset++]=s*.55;vertices[offset++]=c;vertices[offset++]=0;vertices[offset++]=s;}
  const buffer=gl.createBuffer();if(!buffer)throw Error('Ring geometry allocation failed');this.buffer=buffer;this.count=(segments+1)*2;
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
 }
 outerScale(id:string):number{return id==='saturn'?2.32:id==='jupiter'?1.82:id==='uranus'?2.05:2.0;}
 render(viewProjection:number[],model:number[],bodyId:string):void{
  const g=this.gl,config:Record<string,{inner:number;color:[number,number,number];opacity:number}>={
   saturn:{inner:1.24,color:[.72,.66,.54],opacity:.72},
   jupiter:{inner:1.28,color:[.58,.53,.43],opacity:.22},
   uranus:{inner:1.45,color:[.58,.68,.75],opacity:.28},
   neptune:{inner:1.48,color:[.48,.55,.68],opacity:.2}
  };
  const item=config[bodyId];if(!item)return;
  g.useProgram(this.program);g.bindBuffer(g.ARRAY_BUFFER,this.buffer);const a=g.getAttribLocation(this.program,'aPosition');g.enableVertexAttribArray(a);g.vertexAttribPointer(a,3,g.FLOAT,false,0,0);
  g.uniformMatrix4fv(this.locations.uViewProjection,false,new Float32Array(viewProjection));g.uniformMatrix4fv(this.locations.uModel,false,new Float32Array(model));
  g.uniform3f(this.locations.uColor,...item.color);g.uniform1f(this.locations.uInnerRatio,item.inner/this.outerScale(bodyId));g.uniform1f(this.locations.uOpacity,item.opacity);
  g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);g.depthMask(false);g.drawArrays(g.TRIANGLE_STRIP,0,this.count);g.depthMask(true);g.disable(g.BLEND);
 }
 dispose():void{this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);}
}
