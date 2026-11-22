import { orbitalElementsToState } from '../src/physics/orbital-state.js';

const VERTEX = `attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uViewProjection;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vPosition;
void main(){ vec4 world=uModel*vec4(aPosition,1.0); vPosition=world.xyz; vNormal=mat3(uModel)*aNormal; gl_Position=uViewProjection*world; }`;
const FRAGMENT = `precision highp float;
uniform vec3 uColor;
uniform vec3 uLight;
uniform float uKind;
uniform float uDetail;
uniform float uSeed;
varying vec3 vNormal;
varying vec3 vPosition;
float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){
 vec3 n=normalize(vNormal); float light=.20+.80*max(dot(n,normalize(uLight)),0.0);
 float broad=noise(n*(3.0+uDetail*5.0)+uSeed);
 float fine=noise(n*(22.0+uDetail*28.0)+uSeed*3.7);
 vec3 color=uColor;
 if(uKind<.5){float bands=sin((n.y*17.0+broad*2.0)*3.14159)*.5+.5;color=mix(uColor,uColor*vec3(1.35,.88,.62),bands*.30+fine*.08);}
 else if(uKind<1.5){float land=smoothstep(.47,.56,broad*.65+fine*.35);color=mix(uColor*vec3(.12,.32,.72),uColor*vec3(.24,.62,.24),land);color=mix(color,vec3(.82,.88,.91),smoothstep(.70,.84,abs(n.y))*.8);}
 else if(uKind<2.5){float crater=smoothstep(.58,.78,noise(n*75.0+uSeed));color*=.68+.34*broad-crater*.14;}
 else if(uKind<3.5){float bands=sin(n.y*52.0+broad*7.0)*.5+.5;color=mix(uColor*.72,uColor*1.22,bands);}
 else {float cloud=smoothstep(.56,.76,noise(n*34.0+uSeed));color=mix(uColor,uColor*1.5,cloud*.25);}
 float limb=pow(max(dot(n,normalize(uLight)),0.0),.35);
 gl_FragColor=vec4(color*(light)+vec3(.035,.055,.09)*(1.0-limb),1.0);
}`;
const COLORS={sun:[1,.68,.24],mercury:[.48,.49,.50],venus:[.82,.62,.36],earth:[.20,.43,.82],moon:[.62,.65,.69],mars:[.72,.29,.20],jupiter:[.70,.48,.31],saturn:[.76,.68,.48],uranus:[.35,.72,.76],neptune:[.22,.34,.76]};
const KIND={sun:4,mercury:2,venus:4,earth:1,moon:2,mars:2,jupiter:3,saturn:3,uranus:4,neptune:4};
const PLANETS=['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'];
const v3=(x=0,y=0,z=0)=>[x,y,z], add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
function perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2),nf=1/(near-far);return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0];}
function lookAt(eye,target,up){const z=norm(sub(eye,target)),x=norm(cross(up,z)),y=cross(z,x);return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];}
function multiply(a,b){const o=new Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
function sphere(gl,lat=24,lon=32){const p=[],n=[],idx=[];for(let y=0;y<=lat;y++){const v=y/lat,phi=v*Math.PI;for(let x=0;x<=lon;x++){const u=x/lon,theta=u*Math.PI*2,q=[-Math.cos(theta)*Math.sin(phi),Math.cos(phi),Math.sin(theta)*Math.sin(phi)];p.push(...q);n.push(...q);}}for(let y=0;y<lat;y++)for(let x=0;x<lon;x++){const a=y*(lon+1)+x,b=a+lon+1;idx.push(a,b,a+1,b,b+1,a+1);}const buffers=[gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(p),gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,buffers[1]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(n),gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers[2]);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.STATIC_DRAW);return {buffers,count:idx.length};}
function compile(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
function program(gl){const p=gl.createProgram();gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,VERTEX));gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
export class Solar3DView{
 constructor(canvas){this.canvas=canvas;this.gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'high-performance'});if(!this.gl)throw new Error('WebGL недоступен');const gl=this.gl;this.program=program(gl);this.mesh=sphere(gl);this.loc={pos:gl.getAttribLocation(this.program,'aPosition'),normal:gl.getAttribLocation(this.program,'aNormal'),vp:gl.getUniformLocation(this.program,'uViewProjection'),model:gl.getUniformLocation(this.program,'uModel'),color:gl.getUniformLocation(this.program,'uColor'),light:gl.getUniformLocation(this.program,'uLight'),kind:gl.getUniformLocation(this.program,'uKind'),detail:gl.getUniformLocation(this.program,'uDetail'),seed:gl.getUniformLocation(this.program,'uSeed')};this.yaw=.72;this.pitch=.38;this.distance=52;this.target=[0,0,0];this.drag=null;this.selected='earth';this.lastSize='';this.bind();gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.clearColor(.012,.022,.043,1);}
 bind(){const c=this.canvas;c.addEventListener('contextmenu',e=>e.preventDefault());c.addEventListener('pointerdown',e=>{this.drag={x:e.clientX,y:e.clientY,moved:false};c.setPointerCapture(e.pointerId);});c.addEventListener('pointermove',e=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;this.drag.moved ||= Math.hypot(dx,dy)>3;if(e.buttons===1){this.yaw-=dx*.006;this.pitch=Math.max(-1.48,Math.min(1.48,this.pitch+dy*.006));}else if(e.buttons===2){this.target[0]-=dx*.025;this.target[1]+=dy*.025;}this.drag.x=e.clientX;this.drag.y=e.clientY;});const end=e=>{if(!this.drag)return;if(!this.drag.moved)this.pick(e);this.drag=null;};c.addEventListener('pointerup',end);c.addEventListener('pointercancel',()=>this.drag=null);c.addEventListener('wheel',e=>{e.preventDefault();this.distance=Math.max(.025,Math.min(2000,this.distance*Math.exp(e.deltaY*.001)));},{passive:false});c.addEventListener('dblclick',e=>this.pick(e));c.addEventListener('keydown',e=>{if(e.key==='Home')this.home();});c.tabIndex=0;}
 home(){this.yaw=.72;this.pitch=.38;this.distance=52;this.target=[0,0,0];this.selected='earth';}
 focus(id,position){this.selected=id;this.target=this.mapPosition(position);this.distance=Math.max(.025,Math.min(2000,this.distance*.22));}
 mapPosition(p){const d=Math.hypot(p.x,p.y,p.z);if(d<1)return [0,0,0];const k=Math.log1p(d/149597870700)/Math.log(31.1);return [p.x/d*k*42,p.y/d*k*42,p.z/d*k*42];}
 pick(e){const rect=this.canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;let best=null,bd=24;for(const [id,p] of this.projected??[]){const d=Math.hypot(x-p.x,y-p.y);if(d<bd){bd=d;best=id;}}if(best){this.selected=best;this.target=this.projected.find(v=>v[0]===best).world;this.distance=Math.max(.03,this.distance*.35);this.canvas.dispatchEvent(new CustomEvent('bodyselect',{detail:{id:best}}));}}
 render(world,states,timeSeconds){const gl=this.gl,c=this.canvas,rect=c.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.75),w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));if(c.width!==w||c.height!==h){c.width=w;c.height=h;gl.viewport(0,0,w,h);}gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);const eye=[this.target[0]+this.distance*Math.cos(this.pitch)*Math.sin(this.yaw),this.target[1]+this.distance*Math.sin(this.pitch),this.target[2]+this.distance*Math.cos(this.pitch)*Math.cos(this.yaw)];const vp=multiply(perspective(Math.PI/3,w/h,.005,5000),lookAt(eye,this.target,[0,1,0]));gl.uniformMatrix4fv(this.loc.vp,false,new Float32Array(vp));gl.uniform3f(this.loc.light,0,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,this.mesh.buffers[0]);gl.enableVertexAttribArray(this.loc.pos);gl.vertexAttribPointer(this.loc.pos,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,this.mesh.buffers[1]);gl.enableVertexAttribArray(this.loc.normal);gl.vertexAttribPointer(this.loc.normal,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.mesh.buffers[2]);this.projected=[];const sun=states.get('sun')?.position??{x:0,y:0,z:0};const entries=[...world.bodies.values()];for(const b of entries){const s=states.get(b.id);if(!s)continue;const pos=this.mapPosition({x:s.position.x-sun.x,y:s.position.y-sun.y,z:s.position.z-sun.z});const dist=Math.hypot(...sub(pos,this.target));const radius=b.id==='sun'?1.05:Math.max(.035,Math.min(.55,Math.log1p(b.meanRadiusM/1e6)*.045));const projectedRadius=radius*this.distance/Math.max(.01,dist);const segments=projectedRadius>18?48:projectedRadius>5?32:16;const model=[radius,0,0,0,0,radius,0,0,0,0,radius,0,pos[0],pos[1],pos[2],1];gl.uniformMatrix4fv(this.loc.model,false,new Float32Array(model));const color=COLORS[b.id]??[.5,.6,.8];gl.uniform3f(this.loc.color,...color);gl.uniform1f(this.loc.kind,KIND[b.id]??2);gl.uniform1f(this.loc.detail,Math.max(0,Math.min(1,projectedRadius/80)));gl.uniform1f(this.loc.seed,entries.indexOf(b)*13.17);gl.drawElements(gl.TRIANGLES,this.mesh.count,gl.UNSIGNED_SHORT,0);this.projected.push([b.id,{x:w/2,y:h/2,world:pos}]);}
 // Body markers are projected from the actual camera transform for picking.
 const view=lookAt(eye,this.target,[0,1,0]),pv=multiply(vp,view); // Kept only as a stable render-side reference.
 gl.flush();this.lastRenderTime=timeSeconds;
 }
}