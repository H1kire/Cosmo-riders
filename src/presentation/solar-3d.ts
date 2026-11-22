import { orbitalElementsToState } from '../physics/orbital-state.ts';
import { AU } from '../physics/constants.ts';
import { LightingEngine } from './lighting-engine.ts';

const BODY_VERTEX = `attribute vec3 aPosition; attribute vec3 aNormal;
uniform mat4 uViewProjection; uniform mat4 uModel;
uniform float uKind; uniform float uDetail; uniform float uSeed;
varying vec3 vNormal; varying vec3 vPosition;
float vhash(vec3 p){p=fract(p*.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vnoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(vhash(i),vhash(i+vec3(1.,0.,0.)),f.x),mix(vhash(i+vec3(0.,1.,0.)),vhash(i+vec3(1.,1.,0.)),f.x),f.y),mix(mix(vhash(i+vec3(0.,0.,1.)),vhash(i+vec3(1.,0.,1.)),f.x),mix(vhash(i+vec3(0.,1.,1.)),vhash(i+vec3(1.,1.,1.)),f.x),f.y),f.z);}
void main(){vec3 n=normalize(aNormal);float h=vnoise(n*(16.+uDetail*48.)+uSeed);float relief=0.;if(uKind>1.4&&uKind<2.5)relief=(h-.5)*.035;else if(uKind>.5&&uKind<1.5)relief=(h-.5)*.012;else if(uKind>3.5)relief=(h-.5)*.004;vec4 p=uModel*vec4(aPosition,1.0);vPosition=p.xyz;vNormal=mat3(uModel)*n;gl_Position=uViewProjection*p;}`;
const BODY_FRAGMENT = `precision highp float;
uniform vec3 uColor;uniform vec3 uLight;uniform vec3 uLightColor;uniform float uLightIntensity;uniform float uKind;uniform float uDetail;uniform float uSeed;
varying vec3 vNormal;varying vec3 vPosition;
float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1.,0.,0.)),f.x),mix(hash(i+vec3(0.,1.,0.)),hash(i+vec3(1.,1.,0.)),f.x),f.y),mix(mix(hash(i+vec3(0.,0.,1.)),hash(i+vec3(1.,0.,1.)),f.x),mix(hash(i+vec3(0.,1.,1.)),hash(i+vec3(1.,1.,1.)),f.x),f.y),f.z);}
void main(){if(uKind>4.5){gl_FragColor=vec4(uColor*2.8,1.);return;}vec3 n=normalize(vNormal);float l=.24+uLightIntensity*max(dot(n,normalize(uLight)),0.);float a=noise(n*(4.+uDetail*7.)+uSeed);float b=noise(n*(18.+uDetail*34.)+uSeed*3.);vec3 c=uColor;
if(uKind>4.5){c=uColor*(1.15+b*.12);}
else if(uKind<.5){float q=sin((n.y*18.+a*2.)*3.14159)*.5+.5;c=mix(c,c*vec3(1.35,.9,.64),q*.32+b*.08);}
else if(uKind<1.5){float land=smoothstep(.46,.58,a*.7+b*.3);c=mix(c*vec3(.12,.34,.8),c*vec3(.25,.68,.28),land);c=mix(c,vec3(.85,.9,.94),smoothstep(.72,.86,abs(n.y))*.85);}
else if(uKind<2.5){float cr=smoothstep(.62,.8,noise(n*70.+uSeed));c*=.72+.3*a-cr*.16;}
else if(uKind<3.5){float bands=sin(n.y*55.+a*6.)*.5+.5;c=mix(c*.7,c*1.25,bands);}
else{float clouds=smoothstep(.56,.76,noise(n*32.+uSeed));c=mix(c,c*1.5,clouds*.28);}
float limb=pow(max(dot(n,normalize(uLight)),0.),.35);gl_FragColor=vec4(c*uLightColor*l+vec3(.025,.04,.07)*(1.-limb),1.);}`;
const LINE_VERTEX = `attribute vec3 aPosition;uniform mat4 uViewProjection;void main(){gl_Position=uViewProjection*vec4(aPosition,1.);}`;
const LINE_FRAGMENT = `precision mediump float;uniform vec4 uColor;void main(){gl_FragColor=uColor;}`;
const COLORS={sun:[1,.68,.24],mercury:[.48,.49,.5],venus:[.82,.62,.36],earth:[.2,.43,.82],moon:[.62,.65,.69],mars:[.72,.29,.2],jupiter:[.7,.48,.31],saturn:[.76,.68,.48],uranus:[.35,.72,.76],neptune:[.22,.34,.76]};
const KINDS={sun:5,mercury:2,venus:4,earth:1,moon:2,mars:2,jupiter:3,saturn:3,uranus:4,neptune:4};
const NAMES={sun:'Солнце',mercury:'Меркурий',venus:'Венера',earth:'Земля',moon:'Луна',mars:'Марс',jupiter:'Юпитер',saturn:'Сатурн',uranus:'Уран',neptune:'Нептун'};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const m=Math.hypot(...a)||1;return a.map(v=>v/m);};
function perspective(f,a,n,fz){const q=1/Math.tan(f/2),d=1/(n-fz);return[q/a,0,0,0,0,q,0,0,0,0,(fz+n)*d,-1,0,0,2*fz*n*d,0];}
function lookAt(e,t,u){const z=norm(sub(e,t)),x=norm(cross(u,z)),y=cross(z,x);return[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,e),-dot(y,e),-dot(z,e),1];}
function multiply(a,b){const o=Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
function compile(gl,type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function makeProgram(gl,vs,fs){const p=gl.createProgram();gl.attachShader(p,compile(gl,gl.VERTEX_SHADER,vs));gl.attachShader(p,compile(gl,gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
function makeSphere(gl,lat,lon){const p=[],n=[],idx=[];for(let y=0;y<=lat;y++){const v=y/lat,phi=v*Math.PI;for(let x=0;x<=lon;x++){const theta=x/lon*Math.PI*2,q=[-Math.cos(theta)*Math.sin(phi),Math.cos(phi),Math.sin(theta)*Math.sin(phi)];p.push(...q);n.push(...q);}}for(let y=0;y<lat;y++)for(let x=0;x<lon;x++){const a=y*(lon+1)+x,b=a+lon+1;idx.push(a,b,a+1,b,b+1,a+1);}const buffers=[gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(p),gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,buffers[1]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(n),gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers[2]);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.STATIC_DRAW);return{buffers,count:idx.length};}
export class Solar3DView{
 [key: string]: any;
 constructor(canvas){this.canvas=canvas;this.gl=canvas.getContext('webgl',{antialias:true,alpha:false,powerPreference:'high-performance'});if(!this.gl)throw Error('WebGL недоступен');const g=this.gl;this.bodyProgram=makeProgram(g,BODY_VERTEX,BODY_FRAGMENT);this.lineProgram=makeProgram(g,LINE_VERTEX,LINE_FRAGMENT);this.meshes=[makeSphere(g,10,14),makeSphere(g,22,30),makeSphere(g,44,60)];this.lineBuffer=g.createBuffer();this.bodyLoc=this.locations(this.bodyProgram,['aPosition','aNormal','uViewProjection','uModel','uColor','uLight','uLightColor','uLightIntensity','uKind','uDetail','uSeed']);this.lineLoc=this.locations(this.lineProgram,['aPosition','uViewProjection','uColor']);this.yaw=.72;this.pitch=1.28;this.distance=38;this.target=[0,0,0];this.focusOffset=[0,0,0];this.cameraOrigin=[0,0,0];this.lighting=new LightingEngine();this.drag=null;this.projected=[];this.orbitCache=new Map();this.focusId=null;this.labels=document.createElement('div');this.labels.className='body-label-layer';canvas.parentElement.append(this.labels);this.labelNodes=new Map();this.bind();g.enable(g.DEPTH_TEST);g.disable(g.CULL_FACE);g.clearColor(.008,.016,.033,1);}
 locations(p,names){const g=this.gl,o={};for(const n of names)o[n]=n.startsWith('a')?g.getAttribLocation(p,n):g.getUniformLocation(p,n);return o;}
 bind(){
  const c=this.canvas;
  c.tabIndex=0;
  c.addEventListener('contextmenu',e=>e.preventDefault());
  c.addEventListener('pointerdown',e=>{
    if(e.button!==0&&e.button!==1&&e.button!==2)return;
    e.preventDefault();
    c.focus({preventScroll:true});
    this.drag={x:e.clientX,y:e.clientY,moved:false,button:e.button,pointerId:e.pointerId};
    c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('pointermove',e=>{
    if(!this.drag||this.drag.pointerId!==e.pointerId)return;
    const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;
    this.drag.moved ||= Math.hypot(dx,dy)>3;
    // KSP-style map controls: RMB orbits the camera around the current target.
    if(this.drag.button===2){
      this.yaw-=dx*.006;
      this.pitch=Math.max(-1.48,Math.min(1.48,this.pitch+dy*.006));
    // MMB pans in the camera's screen plane, with speed scaled to zoom level.
    }else if(this.drag.button===1){
      const scalePerPixel=2*this.distance*Math.tan(Math.PI/6)/Math.max(1,c.clientHeight);
      const right=[Math.cos(this.yaw),0,-Math.sin(this.yaw)];
      const up=[-Math.sin(this.yaw)*Math.sin(this.pitch),Math.cos(this.pitch),-Math.cos(this.yaw)*Math.sin(this.pitch)];
      const panTarget=this.focusId?this.focusOffset:this.target;for(let axis=0;axis<3;axis++)panTarget[axis]+=(-right[axis]*dx+up[axis]*dy)*scalePerPixel;
    }
    this.drag.x=e.clientX;
    this.drag.y=e.clientY;
  });
  const end=e=>{
    if(!this.drag||this.drag.pointerId!==e.pointerId)return;
    if(!this.drag.moved&&this.drag.button===0)this.pick(e);
    this.drag=null;
  };
  c.addEventListener('pointerup',end);
  c.addEventListener('pointercancel',()=>{this.drag=null;});
  c.addEventListener('lostpointercapture',()=>{this.drag=null;});
  c.addEventListener('wheel',e=>{
    e.preventDefault();
    const nextDistance=this.distance*Math.exp(e.deltaY*.001);
    if(Number.isFinite(nextDistance))this.distance=Math.max(1e-10,Math.min(1e4,nextDistance));
  },{passive:false});
  c.addEventListener('keydown',e=>{if(e.key==='Home')this.home();});
 }
 home(){this.yaw=.72;this.pitch=1.28;this.distance=38;this.target=[0,0,0];this.focusOffset=[0,0,0];this.cameraOrigin=[0,0,0];this.focusId=null;}
 mapPosition(p){return[p.x/AU,p.z/AU,p.y/AU];}
 pick(e){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=null,bd=22;for(const [id,p] of this.projected){const d=Math.hypot(x-p.x,y-p.y);if(d<bd){bd=d;best=id;}}if(best){const item=this.projected.find(v=>v[0]===best);this.focusId=best;this.focusOffset=[0,0,0];this.distance=Math.max(1e-10,(item?.[1]?.radius??1e-5)*20);this.canvas.dispatchEvent(new CustomEvent('bodyselect',{detail:{id:best}}));}}
 project(vp,p,w,h){const[x,y,z]=p,cx=vp[0]*x+vp[4]*y+vp[8]*z+vp[12],cy=vp[1]*x+vp[5]*y+vp[9]*z+vp[13],cz=vp[2]*x+vp[6]*y+vp[10]*z+vp[14],cw=vp[3]*x+vp[7]*y+vp[11]*z+vp[15];return cw>0?{x:(cx/cw*.5+.5)*w,y:(1-(cy/cw*.5+.5))*h,z:cz/cw}:null;}
 drawOrbit(world,body,states,sunPosition,vp,mapper){if(!body.parentId||!body.orbitalElements)return;const parent=world.bodies.get(body.parentId),parentState=states.get(body.parentId);if(!parent||!parentState)return;let path=this.orbitCache.get(body.id);if(!path){path=[];for(let i=0;i<=128;i++){const e=body.orbitalElements,s=orbitalElementsToState({...e,meanAnomaly:e.meanAnomaly+Math.PI*2*i/128},parent.mu);path.push(s.position);}this.orbitCache.set(body.id,path);}const data=[];for(const p of path){const absolute={x:parentState.position.x+p.x,y:parentState.position.y+p.y,z:parentState.position.z+p.z};const mapped=mapper(body,absolute);if(!mapped)return;data.push(...mapped);}const g=this.gl,l=this.lineLoc;g.useProgram(this.lineProgram);g.bindBuffer(g.ARRAY_BUFFER,this.lineBuffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array(data),g.DYNAMIC_DRAW);g.enableVertexAttribArray(l.aPosition);g.vertexAttribPointer(l.aPosition,3,g.FLOAT,false,0,0);g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));g.uniform4f(l.uColor,body.id==='earth'?.32:.18,body.id==='earth'?.58:.28,body.id==='earth'?.9:.42,.62);g.drawArrays(g.LINE_STRIP,0,data.length/3);}
 render(world,states,timeSeconds,vesselState=null){const g=this.gl,c=this.canvas,r=c.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,1.75),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(c.width!==w||c.height!==h){c.width=w;c.height=h;}g.viewport(0,0,w,h);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);const sun=states.get('sun')?.position??{x:0,y:0,z:0};const bodies=[...world.bodies.values()];const focus=this.focusId?world.bodies.get(this.focusId):null,focusState=focus?states.get(focus.id):null;if(focusState){const focusPosition=this.mapPosition({x:focusState.position.x-sun.x,y:focusState.position.y-sun.y,z:focusState.position.z-sun.z});this.cameraOrigin=focusPosition;this.target=this.focusOffset.slice();}else{this.cameraOrigin=[0,0,0];this.target=[0,0,0];}const eye=[this.target[0]+this.distance*Math.cos(this.pitch)*Math.sin(this.yaw),this.target[1]+this.distance*Math.sin(this.pitch),this.target[2]+this.distance*Math.cos(this.pitch)*Math.cos(this.yaw)],far=100,near=Math.max(1e-9,this.distance*.001),vp=multiply(perspective(Math.PI/3,w/h,near,far),lookAt(eye,this.target,[0,1,0]));this.projected=[];const mapper=(b,p)=>{const mapped=this.mapPosition({x:p.x-sun.x,y:p.y-sun.y,z:p.z-sun.z});return mapped.map((value,index)=>value-this.cameraOrigin[index]);};this.lighting.setPointLight('sun',this.cameraOrigin.map(value=>-value),{intensity:22,color:[1,.96,.86]});for(const b of bodies)this.drawOrbit(world,b,states,sun,vp,mapper);g.useProgram(this.bodyProgram);const l=this.bodyLoc;g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));for(const b of bodies){const s=states.get(b.id);if(!s)continue;const p=mapper(b,s.position);if(!p)continue;const d=Math.hypot(...sub(p,this.target)),radius=b.meanRadiusM/AU,viewDistance=Math.hypot(p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]),px=radius*(h/2)/(Math.tan(Math.PI/6)*Math.max(.01,viewDistance)),level=px>70?2:px>18?1:0,mesh=this.meshes[level],model=[radius,0,0,0,0,radius,0,0,0,0,radius,0,p[0],p[1],p[2],1];g.uniformMatrix4fv(l.uModel,false,new Float32Array(model));const light=this.lighting.sampleAt(p,'sun');g.uniform3f(l.uLight,...light.direction);g.uniform3f(l.uLightColor,...light.color);g.uniform1f(l.uLightIntensity,light.intensity);g.uniform3f(l.uColor,...(COLORS[b.id]??[.5,.6,.8]));g.uniform1f(l.uKind,KINDS[b.id]??2);g.uniform1f(l.uDetail,Math.max(0,Math.min(1,px/90)));g.uniform1f(l.uSeed,bodies.indexOf(b)*13.17);g.bindBuffer(g.ARRAY_BUFFER,mesh.buffers[0]);g.enableVertexAttribArray(l.aPosition);g.vertexAttribPointer(l.aPosition,3,g.FLOAT,false,0,0);g.bindBuffer(g.ARRAY_BUFFER,mesh.buffers[1]);g.enableVertexAttribArray(l.aNormal);g.vertexAttribPointer(l.aNormal,3,g.FLOAT,false,0,0);g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,mesh.buffers[2]);g.drawElements(g.TRIANGLES,mesh.count,g.UNSIGNED_SHORT,0);const screen=this.project(vp,p,w/dpr,h/dpr);if(screen&&screen.z>=-1&&screen.z<=1&&screen.x>=-20&&screen.x<=w/dpr+20&&screen.y>=-20&&screen.y<=h/dpr+20)this.projected.push([b.id,{...screen,world:p,radius}]);}if(vesselState?.position){const ship=mapper({id:'vessel',parentId:focus?.id??null},vesselState.position);if(ship){const m=this.meshes[0],r=.045;g.uniformMatrix4fv(l.uModel,false,new Float32Array([r,0,0,0,0,r,0,0,0,0,r,0,ship[0],ship[1],ship[2],1]));g.uniform3f(l.uColor,1,.96,.82);g.uniform3f(l.uLight,0,0,1);g.uniform1f(l.uKind,4);g.uniform1f(l.uDetail,0);g.uniform1f(l.uSeed,99);g.bindBuffer(g.ARRAY_BUFFER,m.buffers[0]);g.enableVertexAttribArray(l.aPosition);g.vertexAttribPointer(l.aPosition,3,g.FLOAT,false,0,0);g.bindBuffer(g.ARRAY_BUFFER,m.buffers[1]);g.enableVertexAttribArray(l.aNormal);g.vertexAttribPointer(l.aNormal,3,g.FLOAT,false,0,0);g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,m.buffers[2]);g.drawElements(g.TRIANGLES,m.count,g.UNSIGNED_SHORT,0);}}for(const [id,p] of this.projected){let node=this.labelNodes.get(id);if(!node){node=document.createElement('span');node.className='body-label';this.labels.append(node);this.labelNodes.set(id,node);}node.textContent=world.bodies.get(id)?.name??NAMES[id]??id;node.style.transform='translate3d('+Math.round(p.x+8)+'px,'+Math.round(p.y-7)+'px,0)';}for(const [id,node] of this.labelNodes)node.hidden=!this.projected.some(item=>item[0]===id);g.flush();this.lastRenderTime=timeSeconds;}
}