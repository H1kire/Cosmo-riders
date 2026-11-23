import { orbitalElementsToState } from '../physics/orbital-state.ts';
import { AU } from '../physics/constants.ts';
import { LightingSystem } from '../rendering/lighting/lighting-system.ts';
import { HDRPipeline } from '../rendering/core/hdr-pipeline.ts';
import { createDefaultShaderLibrary } from '../rendering/shaders/index.ts';
import { ATMOSPHERE_VERTEX, ATMOSPHERE_FRAGMENT, CLOUD_VERTEX, CLOUD_FRAGMENT } from '../rendering/shaders/planet-effects.ts';
import { AtmosphereSystem } from '../rendering/atmosphere/atmosphere-system.ts';
import { CloudSystem } from '../rendering/atmosphere/cloud-system.ts';
import { createGraphicsSettings, type GraphicsSettings } from '../rendering/quality/quality-settings.ts';
import { selectMeshLod, planetaryOrbitOpacity, projectedOrbitRadius } from '../rendering/quality/render-lod.ts';
import { calculateEclipse } from '../rendering/lighting/eclipse-system.ts';
import { PLANET_SURFACE_VERTEX, PLANET_SURFACE_FRAGMENT } from '../rendering/shaders/planet-surface.ts';
import { createSurfaceProfile,surfaceResolutionForProjectedRadius,surfaceProfileKey } from '../rendering/procedural-surface/surface-generator.ts';
import { SurfaceMapCache } from '../rendering/procedural-surface/surface-map-cache.ts';

const LINE_VERTEX = `attribute vec3 aPosition;uniform mat4 uViewProjection;void main(){gl_Position=uViewProjection*vec4(aPosition,1.);}`;
const LINE_FRAGMENT = `precision mediump float;uniform vec4 uColor;void main(){gl_FragColor=uColor;}`;
const COLORS={sun:[1,.68,.24],mercury:[.48,.49,.5],venus:[.82,.62,.36],earth:[.2,.43,.82],moon:[.62,.65,.69],mars:[.72,.29,.2],io:[.82,.68,.24],titan:[.7,.43,.2],jupiter:[.7,.48,.31],saturn:[.76,.68,.48],uranus:[.35,.72,.76],neptune:[.22,.34,.76]};
const KINDS={sun:6,mercury:2,venus:5,earth:1,moon:2,mars:2,jupiter:3,saturn:3,uranus:4,neptune:4,titan:5};
const TEXTURE_DETAIL_CAPS={low:.65,medium:.95,high:1.25,ultra:1.5};
const NAMES={sun:'Солнце',mercury:'Меркурий',venus:'Венера',earth:'Земля',moon:'Луна',mars:'Марс',jupiter:'Юпитер',saturn:'Сатурн',uranus:'Уран',neptune:'Нептун'};
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{const m=Math.hypot(...a)||1;return a.map(v=>v/m);};
function perspective(f,a,n,fz){const q=1/Math.tan(f/2),d=1/(n-fz);return[q/a,0,0,0,0,q,0,0,0,0,(fz+n)*d,-1,0,0,2*fz*n*d,0];}
function lookAt(e,t,u){const z=norm(sub(e,t)),x=norm(cross(u,z)),y=cross(z,x);return[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,e),-dot(y,e),-dot(z,e),1];}
function multiply(a,b){const o=Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];return o;}
function compile(gl,type,src){const s=gl.createShader(type);if(!s)throw Error('WebGL shader allocation failed');let source=src;if(typeof gl.createVertexArray==='function'){source=source.replace(/\battribute\b/g,'in').replace(/\bvarying\b/g,type===gl.VERTEX_SHADER?'out':'in');if(type===gl.FRAGMENT_SHADER&&source.includes('gl_FragColor')){source=source.replace(/(precision\s+\w+\s+float;)/,'$1\nout vec4 outColor;').replace(/gl_FragColor/g,'outColor');}source='#version 300 es\n'+source;}gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(error);}return s;}
function makeProgram(gl,vs,fs){const vertex=compile(gl,gl.VERTEX_SHADER,vs),fragment=compile(gl,gl.FRAGMENT_SHADER,fs),p=gl.createProgram();if(!p){gl.deleteShader(vertex);gl.deleteShader(fragment);throw Error('WebGL program allocation failed');}gl.attachShader(p,vertex);gl.attachShader(p,fragment);gl.linkProgram(p);gl.detachShader(p,vertex);gl.detachShader(p,fragment);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error(error);}return p;}
function makeSphere(gl,lat,lon){const p=[],n=[],idx=[];for(let y=0;y<=lat;y++){const v=y/lat,phi=v*Math.PI;for(let x=0;x<=lon;x++){const theta=x/lon*Math.PI*2,q=[-Math.cos(theta)*Math.sin(phi),Math.cos(phi),Math.sin(theta)*Math.sin(phi)];p.push(...q);n.push(...q);}}for(let y=0;y<lat;y++)for(let x=0;x<lon;x++){const a=y*(lon+1)+x,b=a+lon+1;idx.push(a,b,a+1,b,b+1,a+1);}const buffers=[gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(p),gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,buffers[1]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(n),gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers[2]);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.STATIC_DRAW);return{buffers,count:idx.length};}
export class Solar3DView{
 [key: string]: any;
 constructor(canvas){
  this.canvas=canvas;
  this.gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'high-performance'});
  if(!this.gl)throw Error('WebGL2 недоступен');
  const g=this.gl;
  this.graphics=createGraphicsSettings('high');
  this.surfaceMapCache=new SurfaceMapCache(48*1024*1024);
  this.surfaceGpuTextures=new Map();this.surfaceMapPending=new Set();this.surfaceUploadQueue=[];this.surfaceGpuBytes=0;this.surfaceTextureClock=0;
  this.shaderLibrary=createDefaultShaderLibrary();
  this.hdr=new HDRPipeline(g,Math.max(1,canvas.width),Math.max(1,canvas.height),this.graphics.msaaSamples);
  this.applyGraphicsSettings(this.graphics);
  this.graphicsChangeHandler=(event:Event)=>{
    const value=(event as CustomEvent<Partial<GraphicsSettings>>).detail??{};
    this.graphics={...this.graphics,...value};
    this.applyGraphicsSettings(this.graphics);
  };
  window.addEventListener('graphics-settings-change',this.graphicsChangeHandler);
  this.bodyProgram=makeProgram(g,PLANET_SURFACE_VERTEX,PLANET_SURFACE_FRAGMENT);
  this.atmosphereProgram=makeProgram(g,ATMOSPHERE_VERTEX,this.shaderLibrary.compose(ATMOSPHERE_FRAGMENT));
  this.cloudProgram=makeProgram(g,CLOUD_VERTEX,this.shaderLibrary.compose(CLOUD_FRAGMENT));
  this.lineProgram=makeProgram(g,LINE_VERTEX,LINE_FRAGMENT);
  this.meshes=[makeSphere(g,10,14),makeSphere(g,22,30),makeSphere(g,44,60),makeSphere(g,128,192)];
  this.lineBuffer=g.createBuffer();
  this.bodyLoc=this.locations(this.bodyProgram,['aPosition','aNormal','uViewProjection','uModel','uColor','uCameraPosition','uLightPositions[0]','uLightColors[0]','uLightIntensities[0]','uLightCount','uKind','uDetail','uSeed','uWaterFraction','uIceFraction','uIronFraction','uTectonicActivity','uVolcanicActivity','uErosion','uGeneratedAlbedo','uGeneratedNormal','uGeneratedHeight','uGeneratedRoughness','uUseGeneratedMaps','uSunPosition','uSunRadius','uOccluders[0]','uOccluderRadii[0]','uOccluderCount','uShadows']);
  this.atmosphereLoc=this.locations(this.atmosphereProgram,['aPosition','aNormal','uViewProjection','uModel','uLightColor','uCameraPosition','uAtmosphereColor','uMie','uMieAnisotropy','uIntensity','uSunPosition','uSunRadius','uOccluders[0]','uOccluderRadii[0]','uOccluderCount','uShadows','uPlanetCenter','uGroundRadius','uAtmosphereRadius','uRayleighScaleHeight','uMieScaleHeight','uAtmosphereSamples','uLightIntensity']);
  this.cloudLoc=this.locations(this.cloudProgram,['aPosition','aNormal','uViewProjection','uModel','uLightColor','uTime','uWind','uCoverage','uOpacity','uScale','uSeed','uSunPosition','uSunRadius','uOccluders[0]','uOccluderRadii[0]','uOccluderCount','uShadows','uLightIntensity']);
  this.lineLoc=this.locations(this.lineProgram,['aPosition','uViewProjection','uColor']);
  this.atmosphereSystem=new AtmosphereSystem();
  this.cloudSystem=new CloudSystem();
  this.yaw=.72;this.pitch=1.28;this.distance=38;this.target=[0,0,0];
  this.focusOffset=[0,0,0];this.cameraOrigin=[0,0,0];this.lighting=new LightingSystem();this.stellarSourceDefinitions=new Map();
  this.drag=null;this.projected=[];this.orbitCache=new Map();this.focusId=null;this.focusTransition=null;
  this.labels=document.createElement('div');this.labels.className='body-label-layer';canvas.parentElement.append(this.labels);
  this.labelNodes=new Map();this.bind();
  g.enable(g.DEPTH_TEST);g.disable(g.CULL_FACE);g.clearColor(.008,.016,.033,1);
 }
 applyGraphicsSettings(settings){
  this.hdr.setHDREnabled(settings.hdr);
  this.hdr.setMultisampleSamples(settings.msaaSamples);
  const h=this.hdr.settings;
  h.bloom=settings.bloom;h.bloomThreshold=settings.bloomThreshold;h.bloomStrength=settings.bloomStrength;
  h.bloomIterations=settings.bloomIterations;h.glare=settings.glare;h.glareStrength=settings.glareStrength;
  h.lensFlare=settings.lensFlare;h.lensFlareStrength=settings.lensFlareStrength;
  h.hdr=settings.hdr;h.exposure=settings.exposure;h.toneMapping=settings.hdr?'aces':'reinhard';
 }
 configurePlanetEffects(){
  const profiles:[string,number,[number,number,number],number,number][]=[
   ['earth',110000,[.22,.48,1.0],.62,1.0],\n   ['titan',400000,[.72,.43,.18],.96,1.25],
   ['venus',250000,[1.0,.58,.28],.92,1.1],
   ['mars',100000,[1.0,.34,.19],.34,.72],
   ['jupiter',1200000,[.82,.62,.43],.48,.58],
   ['saturn',900000,[.91,.73,.49],.52,.52],
   ['uranus',500000,[.42,.82,.88],.36,.48],
   ['neptune',500000,[.28,.48,1.0],.44,.55]
  ];
  for(const [id,height,color,mie,intensity] of profiles){
   const body=this.systemBodyById?.get(id);
   if(body)this.atmosphereSystem.setProfile({bodyId:id,groundRadiusM:body.meanRadiusM,atmosphereHeightM:height,rayleigh:color, mie,rayleighScaleHeightM:height*.12,mieScaleHeightM:height*.08,mieAnisotropy:.76,intensity});
  }
  const cloudProfiles:[string,number,number,number,number][]=[
   ['earth',18000,.48,.82,5.8],\n   ['titan',18000,.72,.62,3.8],
   ['venus',55000,.59,.78,4.4],
   ['jupiter',70000,.55,.54,7.2],
   ['saturn',65000,.58,.48,6.0],
   ['uranus',35000,.61,.38,5.0],
   ['neptune',30000,.58,.4,5.4]
  ];
  for(const [id,altitudeM,coverage,opacity,scale] of cloudProfiles){
   this.cloudSystem.setLayers(id,[{id:'main',altitudeM,coverage,opacity,wind:[.0002,.0001],scale}]);
  }
 }
 bindMesh(mesh,loc){
  const g=this.gl;
  g.bindBuffer(g.ARRAY_BUFFER,mesh.buffers[0]);g.enableVertexAttribArray(loc.aPosition);g.vertexAttribPointer(loc.aPosition,3,g.FLOAT,false,0,0);
  g.bindBuffer(g.ARRAY_BUFFER,mesh.buffers[1]);g.enableVertexAttribArray(loc.aNormal);g.vertexAttribPointer(loc.aNormal,3,g.FLOAT,false,0,0);
  g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,mesh.buffers[2]);
 }
 drawAtmosphere(body,profile,p,radius,mesh,vp,eye,light,occluders){
  const g=this.gl,l=this.atmosphereLoc,shellRadius=radius*(1+profile.atmosphereHeightM/profile.groundRadiusM);
  const model=[shellRadius,0,0,0,0,shellRadius,0,0,0,0,shellRadius,0,p[0],p[1],p[2],1];
  g.useProgram(this.atmosphereProgram);g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));
  g.uniformMatrix4fv(l.uModel,false,new Float32Array(model));
  g.uniform3f(l.uLightColor,...light.color);g.uniform3f(l.uCameraPosition,...eye);
  g.uniform3f(l.uAtmosphereColor,...profile.rayleigh);g.uniform1f(l.uMie,profile.mie);g.uniform1f(l.uMieAnisotropy,profile.mieAnisotropy);
  g.uniform3f(l.uPlanetCenter,...p);g.uniform1f(l.uGroundRadius,radius);g.uniform1f(l.uAtmosphereRadius,shellRadius);
  g.uniform1f(l.uRayleighScaleHeight,profile.rayleighScaleHeightM/AU);g.uniform1f(l.uMieScaleHeight,profile.mieScaleHeightM/AU);
  g.uniform1i(l.uAtmosphereSamples,this.graphics.atmosphereSamples);
  g.uniform1f(l.uIntensity,(profile.intensity??1)*this.graphics.atmosphereIntensity);
  g.uniform3f(l.uSunPosition,...this.currentSunPosition);g.uniform1f(l.uSunRadius,696340000/AU);g.uniform3fv(l['uOccluders[0]'],occluders.positions);g.uniform1fv(l['uOccluderRadii[0]'],occluders.radii);g.uniform1i(l.uOccluderCount,occluders.count);g.uniform1i(l.uShadows,this.graphics.shadows?1:0);g.uniform1f(l.uLightIntensity,light.intensity/22);this.bindMesh(mesh,l);g.drawElements(g.TRIANGLES,mesh.count,g.UNSIGNED_SHORT,0);
 }
 drawClouds(body,layers,p,radius,mesh,vp,light,occluders,timeSeconds){
  const g=this.gl,l=this.cloudLoc;
  g.useProgram(this.cloudProgram);g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));
  g.uniform3f(l.uLightColor,...light.color);
  g.uniform1f(l.uTime,timeSeconds%100000);g.uniform3f(l.uSunPosition,...this.currentSunPosition);g.uniform1f(l.uSunRadius,696340000/AU);g.uniform3fv(l['uOccluders[0]'],occluders.positions);g.uniform1fv(l['uOccluderRadii[0]'],occluders.radii);g.uniform1i(l.uOccluderCount,occluders.count);g.uniform1i(l.uShadows,this.graphics.shadows?1:0);g.uniform1f(l.uLightIntensity,light.intensity/22);
  for(const layer of layers){
   const shellRadius=radius*(1+layer.altitudeM/body.meanRadiusM);
   const model=[shellRadius,0,0,0,0,shellRadius,0,0,0,0,shellRadius,0,p[0],p[1],p[2],1];
   g.uniformMatrix4fv(l.uModel,false,new Float32Array(model));g.uniform1f(l.uCoverage,layer.coverage);
   g.uniform2f(l.uWind,layer.wind[0],layer.wind[1]);g.uniform1f(l.uOpacity,layer.opacity);g.uniform1f(l.uScale,layer.scale*this.graphics.cloudDetail);
   g.uniform1f(l.uSeed,body.meanRadiusM*.000001);this.bindMesh(mesh,l);g.drawElements(g.TRIANGLES,mesh.count,g.UNSIGNED_SHORT,0);
  }
 }
 collectOccluders(body,bodyState,sunState,bodies,states,renderOrigin){
  const sx=sunState.position.x-bodyState.position.x,sy=sunState.position.y-bodyState.position.y,sz=sunState.position.z-bodyState.position.z;
  const sunDistance=Math.hypot(sx,sy,sz);if(sunDistance<=0)return{positions:new Float32Array(24),radii:new Float32Array(8),count:0};
  const direction=[sx/sunDistance,sy/sunDistance,sz/sunDistance];
  const candidates=[];
  for(const other of bodies){
   if(other.id===body.id||other.id==='sun')continue;
   const state=states.get(other.id);if(!state)continue;
   const dx=state.position.x-bodyState.position.x,dy=state.position.y-bodyState.position.y,dz=state.position.z-bodyState.position.z;
   const along=dx*direction[0]+dy*direction[1]+dz*direction[2];
   if(along<=0||along>=sunDistance)continue;
   const px=dx-direction[0]*along,py=dy-direction[1]*along,pz=dz-direction[2]*along;
   const perpendicular=Math.hypot(px,py,pz),radius=other.meanRadiusM;
   if(perpendicular>radius+body.meanRadiusM)continue;
   candidates.push({state,body:other,score:perpendicular/Math.max(radius,1)});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const selected=candidates.slice(0,Math.min(8,this.graphics.shadowOccluders));
  const positions=new Float32Array(24),radii=new Float32Array(8);
  selected.forEach((item,index)=>{
   const mapped=this.mapPosition({x:item.state.position.x-renderOrigin.x,y:item.state.position.y-renderOrigin.y,z:item.state.position.z-renderOrigin.z});
   positions.set(mapped,index*3);radii[index]=item.body.meanRadiusM/AU;
  });
  return{positions,radii,count:selected.length};
 }


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
 setStellarSource(id:string,positionSI:[number,number,number],options:{intensity?:number;color?:[number,number,number]}={}){
  if(!id||id==='sun')throw new TypeError('Use a unique non-primary stellar source id.');
  if(!positionSI.every(Number.isFinite))throw new TypeError('Stellar source coordinates must be finite SI values.');
  this.stellarSourceDefinitions.set(id,{positionSI:[...positionSI],intensity:options.intensity??22,color:options.color?[...options.color] as [number,number,number]:[1,1,1]});
 }
 removeStellarSource(id:string){if(id==='sun')throw new TypeError('The primary Sun source cannot be removed.');this.stellarSourceDefinitions.delete(id);this.lighting.removeSource(id);}
 focusOn(id,world){
  const item=world?.bodies?.get(id);
  if(!item)return false;
  const radius=item.meanRadiusM/AU;
  const nextDistance=Math.max(radius*18,1e-9);
  this.focusId=id;
  this.focusOffset=[0,0,0];
  this.focusTransition={from:this.distance,to:nextDistance,started:performance.now(),duration:720};
  return true;
 }
 home(){this.yaw=.72;this.pitch=1.28;this.distance=38;this.target=[0,0,0];this.focusOffset=[0,0,0];this.cameraOrigin=[0,0,0];this.focusId=null;this.focusTransition=null;}
 mapPosition(p):[number,number,number]{return[p.x/AU,p.z/AU,p.y/AU];}
 pick(e){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=null,bd=22;for(const [id,p] of this.projected){const d=Math.hypot(x-p.x,y-p.y);if(d<bd){bd=d;best=id;}}if(best){const item=this.projected.find(v=>v[0]===best);this.focusId=best;this.focusOffset=[0,0,0];this.distance=Math.max(1e-10,(item?.[1]?.radius??1e-5)*20);this.canvas.dispatchEvent(new CustomEvent('bodyselect',{detail:{id:best}}));}}
 project(vp,p,w,h){const[x,y,z]=p,cx=vp[0]*x+vp[4]*y+vp[8]*z+vp[12],cy=vp[1]*x+vp[5]*y+vp[9]*z+vp[13],cz=vp[2]*x+vp[6]*y+vp[10]*z+vp[14],cw=vp[3]*x+vp[7]*y+vp[11]*z+vp[15];return cw>0?{x:(cx/cw*.5+.5)*w,y:(1-(cy/cw*.5+.5))*h,z:cz/cw}:null;}
 drawOrbit(world,body,states,sunPosition,vp,mapper,opacity=1,eye,viewportHeight){if(!body.parentId||!body.orbitalElements||opacity<=0.005)return;const parent=world.bodies.get(body.parentId),parentState=states.get(body.parentId);if(!parent||!parentState)return;const parentPosition=mapper(parent,parentState.position),parentDistance=Math.hypot(parentPosition[0]-eye[0],parentPosition[1]-eye[1],parentPosition[2]-eye[2]);if(projectedOrbitRadius(body.orbitalElements.semiMajorAxisM/AU,viewportHeight,parentDistance)<0.8)return;let path=this.orbitCache.get(body.id);if(!path){path=[];const eccentricity=Math.max(0,Math.min(0.95,body.orbitalElements.eccentricity??0)),segments=Math.max(512,Math.min(1024,Math.ceil(512*(1+eccentricity))));for(let i=0;i<=segments;i++){const e=body.orbitalElements,s=orbitalElementsToState({...e,meanAnomaly:e.meanAnomaly+Math.PI*2*i/segments},parent.mu);path.push(s.position);}this.orbitCache.set(body.id,path);}const data=[];for(const p of path){const absolute={x:parentState.position.x+p.x,y:parentState.position.y+p.y,z:parentState.position.z+p.z};const mapped=mapper(body,absolute);if(!mapped)return;data.push(...mapped);}const g=this.gl,l=this.lineLoc;g.useProgram(this.lineProgram);g.bindBuffer(g.ARRAY_BUFFER,this.lineBuffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array(data),g.DYNAMIC_DRAW);g.enableVertexAttribArray(l.aPosition);g.vertexAttribPointer(l.aPosition,3,g.FLOAT,false,0,0);g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));g.uniform4f(l.uColor,body.id==='earth'?.34:.2,body.id==='earth'?.62:.32,body.id==='earth'?.94:.48,.68*opacity);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);g.depthMask(false);g.drawArrays(g.LINE_STRIP,0,data.length/3);g.depthMask(true);g.disable(g.BLEND);}
 render(world,states,timeSeconds,vesselState=null){
  if(this.focusTransition){
   const progress=Math.min(1,(performance.now()-this.focusTransition.started)/this.focusTransition.duration);
   const eased=progress*progress*(3-2*progress);
   this.distance=this.focusTransition.from+(this.focusTransition.to-this.focusTransition.from)*eased;
   if(progress>=1)this.focusTransition=null;
  }
  const g=this.gl,c=this.canvas,r=c.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
  const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
  if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
  const renderScale=this.graphics?.renderScale??1,renderWidth=Math.max(1,Math.round(w*renderScale)),renderHeight=Math.max(1,Math.round(h*renderScale));
  this.hdr.begin(renderWidth,renderHeight);
  this.processSurfaceUploads();
  if(focus&&focusState){const focusPosition=mapper(focus,focusState.position),focusRadius=focus.meanRadiusM/AU,focusDistance=Math.hypot(focusPosition[0]-eye[0],focusPosition[1]-eye[1],focusPosition[2]-eye[2]),focusPixels=focusRadius*(h/2)/(Math.tan(Math.PI/6)*Math.max(focusRadius,focusDistance));if(focusPixels>=8){const focusProfile=createSurfaceProfile(focus);this.requestSurfaceMaps(focusProfile,surfaceResolutionForProjectedRadius(focusPixels));}}
  const sunState=states.get('sun')??{position:{x:0,y:0,z:0}};
  const sun=sunState.position,bodies=[...world.bodies.values()];
  this.systemBodyById=new Map(bodies.map(body=>[body.id,body]));
  if(!this.effectsConfigured){this.configurePlanetEffects();this.effectsConfigured=true;}
  const focus=this.focusId?world.bodies.get(this.focusId):null,focusState=focus?states.get(focus.id):null;
  if(focusState){this.cameraOrigin=[0,0,0];this.target=this.focusOffset.slice();}
  else{this.cameraOrigin=[0,0,0];this.target=[0,0,0];}
  const eye=[this.target[0]+this.distance*Math.cos(this.pitch)*Math.sin(this.yaw),this.target[1]+this.distance*Math.sin(this.pitch),this.target[2]+this.distance*Math.cos(this.pitch)*Math.cos(this.yaw)];
  const far=100,near=Math.max(1e-10,this.distance*.001),vp=multiply(perspective(Math.PI/3,w/h,near,far),lookAt(eye,this.target,[0,1,0]));
  this.projected=[];
  const renderOrigin=focusState?focusState.position:sun;
  const mapper=(body,p)=>this.mapPosition({x:p.x-renderOrigin.x,y:p.y-renderOrigin.y,z:p.z-renderOrigin.z});
  const sunRenderPosition=mapper(null,sun);this.currentSunPosition=sunRenderPosition;
  if(this.lighting.getSources().some(source=>source.id==='sun'))this.lighting.updateSource('sun',{position:sunRenderPosition});
  else this.lighting.addSource({id:'sun',kind:'point',position:sunRenderPosition,intensity:22,color:[1,.96,.86]});
  // Keep externally registered stellar sources while refreshing the primary star position.
  for(const [id,source] of this.stellarSourceDefinitions){
   const position=mapper(null,{x:source.positionSI[0],y:source.positionSI[1],z:source.positionSI[2]});
   if(this.lighting.getSources().some(item=>item.id===id))this.lighting.updateSource(id,{position});
   else this.lighting.addSource({id,kind:'point',position,intensity:source.intensity,color:source.color});
  }
  const lightSources=this.lighting.getLights().sort((a,b)=>a.id==='sun'?-1:b.id==='sun'?1:0).slice(0,4);
  const lightPositions=new Float32Array(12),lightColors=new Float32Array(12),lightIntensities=new Float32Array(4);
  lightSources.forEach((source,index)=>{lightPositions.set(source.position,index*3);lightColors.set(source.color,index*3);lightIntensities[index]=source.intensity;});
  let planetOrbitFade=1,orbitAnchor=focus,orbitCameraDistance=this.distance;
  if(orbitAnchor){
   while(orbitAnchor.parentId&&orbitAnchor.parentId!=='sun')orbitAnchor=world.bodies.get(orbitAnchor.parentId)??orbitAnchor;
  }else{
   let nearestDistance=Infinity;
   for(const candidate of bodies){
    if(candidate.parentId!=='sun')continue;
    const candidateState=states.get(candidate.id);if(!candidateState)continue;
    const candidatePosition=mapper(candidate,candidateState.position);
    const candidateDistance=Math.hypot(candidatePosition[0]-eye[0],candidatePosition[1]-eye[1],candidatePosition[2]-eye[2]);
    if(candidateDistance<nearestDistance){nearestDistance=candidateDistance;orbitAnchor=candidate;orbitCameraDistance=candidateDistance;}
   }
  }
  if(orbitAnchor?.parentId==='sun')planetOrbitFade=planetaryOrbitOpacity(orbitCameraDistance,orbitAnchor.meanRadiusM/AU);
  for(const body of bodies)this.drawOrbit(world,body,states,sun,vp,mapper,body.parentId==='sun'?planetOrbitFade:1,eye,h);
  g.useProgram(this.bodyProgram);
  const l=this.bodyLoc;g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));
  
  for(const body of bodies){
   g.useProgram(this.bodyProgram);
   const state=states.get(body.id);if(!state)continue;
   const p=mapper(body,state.position);if(!p)continue;
   const radius=body.meanRadiusM/AU,viewDistance=Math.hypot(p[0]-eye[0],p[1]-eye[1],p[2]-eye[2]);
   const px=radius*(h/2)/(Math.tan(Math.PI/6)*Math.max(radius,viewDistance));
   const projectedScreen=this.project(vp,p,w/dpr,h/dpr);
   const level=selectMeshLod(px,this.graphics.maxMeshLod),mesh=this.meshes[level];
   
   const model=[radius,0,0,0,0,radius,0,0,0,0,radius,0,p[0],p[1],p[2],1];
   g.uniformMatrix4fv(l.uModel,false,new Float32Array(model));
   const light=this.lighting.sampleAt(p,'sun');
   g.uniform3f(l.uCameraPosition,...eye);
   g.uniform3fv(l['uLightPositions[0]'],lightPositions);g.uniform3fv(l['uLightColors[0]'],lightColors);
   g.uniform1fv(l['uLightIntensities[0]'],lightIntensities);g.uniform1i(l.uLightCount,lightSources.length);
   const isStar=!body.parentId;
    const surfaceProfile=isStar?null:createSurfaceProfile(body);
    const profileKind=surfaceProfile?.class==='gas-giant'?3:surfaceProfile?.class==='ice-giant'?4:surfaceProfile?.class==='dense-atmosphere'?5:surfaceProfile?.class==='oceanic'?1:surfaceProfile?.class==='icy'||surfaceProfile?.class==='icy-moon'?5.3:surfaceProfile?.class==='volcanic'||surfaceProfile?.class==='volcanic-moon'?5.4:surfaceProfile?.class==='desert'?2.4:surfaceProfile?.class==='airless-moon'?2.2:2;
    g.uniform3f(l.uColor,...(COLORS[body.id]??(isStar?[1,.72,.42]:[.5,.6,.8])));g.uniform1f(l.uKind,isStar?6:(KINDS[body.id]??profileKind));
   g.uniform1f(l.uDetail,Math.min(TEXTURE_DETAIL_CAPS[this.graphics.textureQuality]??1,Math.max(0,Math.min(1.5,Math.log2(Math.max(1,px)/18)/4))));
    if(isStar){
     g.uniform1f(l.uUseGeneratedMaps,0);g.uniform1f(l.uSeed,0);
     g.uniform1f(l.uWaterFraction,0);g.uniform1f(l.uIceFraction,0);g.uniform1f(l.uIronFraction,0);
     g.uniform1f(l.uTectonicActivity,0);g.uniform1f(l.uVolcanicActivity,0);g.uniform1f(l.uErosion,0);
    }else{
     const surfaceResolution=surfaceResolutionForProjectedRadius(px);
     this.requestSurfaceMaps(surfaceProfile,surfaceResolution);
     this.bindSurfaceMaps(surfaceProfile,surfaceResolution,l);
     g.uniform1f(l.uSeed,surfaceProfile.seed%16777216);
     g.uniform1f(l.uWaterFraction,surfaceProfile.waterFraction);
     g.uniform1f(l.uIceFraction,surfaceProfile.iceFraction);
     g.uniform1f(l.uIronFraction,surfaceProfile.ironFraction);
     g.uniform1f(l.uTectonicActivity,surfaceProfile.tectonicActivity);
     g.uniform1f(l.uVolcanicActivity,surfaceProfile.volcanicActivity);
     g.uniform1f(l.uErosion,surfaceProfile.erosion);
    }
   g.uniform3f(l.uSunPosition,...sunRenderPosition);g.uniform1f(l.uSunRadius,696340000/AU);
   const occluders=this.collectOccluders(body,state,sunState,bodies,states,renderOrigin);
   g.uniform3fv(l['uOccluders[0]'],occluders.positions);g.uniform1fv(l['uOccluderRadii[0]'],occluders.radii);
   g.uniform1i(l.uOccluderCount,occluders.count);g.uniform1i(l.uShadows,this.graphics.shadows?1:0);
   this.bindMesh(mesh,l);g.drawElements(g.TRIANGLES,mesh.count,g.UNSIGNED_SHORT,0);
   const profile=this.atmosphereSystem.getProfile(body.id);
   const cloudLayers=this.cloudSystem.getLayers(body.id);
   if(this.graphics.atmosphere&&profile){
    g.enable(g.CULL_FACE);g.cullFace(g.BACK);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE);g.depthMask(false);
    this.drawAtmosphere(body,profile,p,radius,mesh,vp,eye,light,occluders);
    g.depthMask(true);g.disable(g.BLEND);g.disable(g.CULL_FACE);
   }
   if(this.graphics.clouds&&cloudLayers.length){
    g.enable(g.CULL_FACE);g.cullFace(g.BACK);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);g.depthMask(false);
    this.drawClouds(body,cloudLayers,p,radius,mesh,vp,light,occluders,timeSeconds);
    g.depthMask(true);g.disable(g.BLEND);g.disable(g.CULL_FACE);
   }
   const screen=projectedScreen;
   if(screen&&screen.z>=-1&&screen.z<=1&&screen.x>=-20&&screen.x<=w/dpr+20&&screen.y>=-20&&screen.y<=h/dpr+20)this.projected.push([body.id,{...screen,world:p,radius}]);
  }
  g.useProgram(this.bodyProgram);g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));
  if(vesselState?.position){
   const ship=mapper({id:'vessel',parentId:focus?.id??null},vesselState.position);
   if(ship){
    const mesh=this.meshes[0],shipDistance=Math.max(1e-12,Math.hypot(ship[0]-eye[0],ship[1]-eye[1],ship[2]-eye[2]));
    const shipRadius=shipDistance*8*Math.tan(Math.PI/6)/h;
    g.uniformMatrix4fv(l.uModel,false,new Float32Array([shipRadius,0,0,0,0,shipRadius,0,0,0,0,shipRadius,0,ship[0],ship[1],ship[2],1]));
    g.uniform3f(l.uColor,1,.96,.82);g.uniform3f(l.uCameraPosition,...eye);g.uniform3fv(l['uLightPositions[0]'],lightPositions);g.uniform3fv(l['uLightColors[0]'],lightColors);g.uniform1fv(l['uLightIntensities[0]'],lightIntensities);g.uniform1i(l.uLightCount,lightSources.length);
    g.uniform1f(l.uKind,7);g.uniform1f(l.uDetail,0);g.uniform1f(l.uSeed,99);g.uniform1f(l.uUseGeneratedMaps,0);
    g.uniform1i(l.uOccluderCount,0);g.uniform1i(l.uShadows,0);
    this.bindMesh(mesh,l);g.drawElements(g.TRIANGLES,mesh.count,g.UNSIGNED_SHORT,0);
   }
  }
  for(const [id,p] of this.projected){
   let node=this.labelNodes.get(id);
   if(!node){node=document.createElement('span');node.className='body-label';this.labels.append(node);this.labelNodes.set(id,node);}
   node.textContent=world.bodies.get(id)?.name??NAMES[id]??id;
   node.style.transform='translate3d('+Math.round(p.x+8)+'px,'+Math.round(p.y-7)+'px,0)';
  }
  for(const [id,node] of this.labelNodes)node.hidden=!this.projected.some(item=>item[0]===id);
  const sunScreen=this.project(vp,sunRenderPosition,w/dpr,h/dpr);
  let sunVisible=Boolean(sunScreen&&sunScreen.z>=-1&&sunScreen.z<=1&&sunScreen.x>=0&&sunScreen.x<=w/dpr&&sunScreen.y>=0&&sunScreen.y<=h/dpr);
  if(sunVisible){
   const observerSI={x:renderOrigin.x+eye[0]*AU,y:renderOrigin.y+eye[2]*AU,z:renderOrigin.z+eye[1]*AU};
   const observer=[observerSI.x,observerSI.y,observerSI.z] as [number,number,number];
   const source=[sun.x,sun.y,sun.z] as [number,number,number];
   let visibility=1;
   for(const body of bodies){
    if(body.id==='sun')continue;
    const state=states.get(body.id);if(!state)continue;
    const blocker=[state.position.x,state.position.y,state.position.z] as [number,number,number];
    visibility*=calculateEclipse(source,696340000,blocker,body.meanRadiusM,observer).visibility;
    if(visibility<.001)break;
   }
   sunVisible=visibility>.02;
  }
  if(sunScreen)this.hdr.setOpticalSource([sunScreen.x/(w/dpr),1-sunScreen.y/(h/dpr)],sunVisible);
  else this.hdr.setOpticalSource([.5,.5],false);
  this.hdr.present(w,h);g.flush();this.lastRenderTime=timeSeconds;
 }
 requestSurfaceMaps(profile,resolution){
  const profileKey=surfaceProfileKey(profile),key=profileKey+':'+resolution;
  if(this.surfaceGpuTextures.has(key)||this.surfaceMapPending.has(key)||this.disposed)return;
  if(this.surfaceUploadQueue.some(job=>job.key===key))return;
  this.surfaceMapPending.add(key);
  this.surfaceMapCache.get(profile,resolution).then(maps=>{
   this.surfaceMapPending.delete(key);if(this.disposed)return;
   this.surfaceUploadQueue.push({key,profileKey,resolution,maps,textures:[],faceIndex:0,mipIndex:0,created:0});
  }).catch(()=>{this.surfaceMapPending.delete(key);});
 }
 processSurfaceUploads(){
  const g=this.gl,job=this.surfaceUploadQueue[0];if(!job||this.disposed)return;
  const active=g.getParameter(g.ACTIVE_TEXTURE);g.activeTexture(g.TEXTURE7);
  const previous=g.getParameter(g.TEXTURE_BINDING_CUBE_MAP);
  const channels=[job.maps.albedo,job.maps.height,job.maps.roughness,job.maps.normal];
  if(job.textures.length===0){
   for(let i=0;i<4;i++){
    const texture=g.createTexture();if(!texture){for(const allocated of job.textures)g.deleteTexture(allocated);this.surfaceUploadQueue.shift();g.bindTexture(g.TEXTURE_CUBE_MAP,previous);g.activeTexture(active);return;}
    g.bindTexture(g.TEXTURE_CUBE_MAP,texture);
    g.texParameteri(g.TEXTURE_CUBE_MAP,g.TEXTURE_MIN_FILTER,g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_CUBE_MAP,g.TEXTURE_MAG_FILTER,g.LINEAR);
    g.texParameteri(g.TEXTURE_CUBE_MAP,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_CUBE_MAP,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
    job.textures.push(texture);
   }
  }
  const faceBytes=job.resolution*job.resolution*4;
  let budget=2;
  while(budget-->0&&job.faceIndex<24){
   const textureIndex=Math.floor(job.faceIndex/6),face=job.faceIndex%6;
   g.bindTexture(g.TEXTURE_CUBE_MAP,job.textures[textureIndex]);
   const data=channels[textureIndex].subarray(face*faceBytes,(face+1)*faceBytes);
   g.texImage2D(g.TEXTURE_CUBE_MAP_POSITIVE_X+face,0,g.RGBA,job.resolution,job.resolution,0,g.RGBA,g.UNSIGNED_BYTE,data);
   job.faceIndex++;
  }
  if(job.faceIndex===24&&job.mipIndex<4){
   g.bindTexture(g.TEXTURE_CUBE_MAP,job.textures[job.mipIndex]);
   g.generateMipmap(g.TEXTURE_CUBE_MAP);
   job.mipIndex++;
  }
  g.bindTexture(g.TEXTURE_CUBE_MAP,previous);g.activeTexture(active);
  if(job.faceIndex===24&&job.mipIndex===4){
   const bytes=Math.ceil(job.resolution*job.resolution*4*6*4*4/3);
   while(this.surfaceGpuBytes+bytes>64*1024*1024&&this.surfaceGpuTextures.size){
    let oldestKey=null,oldest=Infinity;
    for(const [candidate,entry] of this.surfaceGpuTextures)if(entry.used<oldest){oldest=entry.used;oldestKey=candidate;}
    if(oldestKey===null)break;
    const old=this.surfaceGpuTextures.get(oldestKey);for(const texture of old.textures)g.deleteTexture(texture);
    this.surfaceGpuBytes-=old.bytes;this.surfaceGpuTextures.delete(oldestKey);
   }
   if(bytes<=64*1024*1024){
    this.surfaceGpuTextures.set(job.key,{textures:job.textures,bytes,used:++this.surfaceTextureClock,created:performance.now(),resolution:job.resolution,profileKey:job.profileKey});
    this.surfaceGpuBytes+=bytes;
   }else for(const texture of job.textures)g.deleteTexture(texture);
   this.surfaceUploadQueue.shift();
  }
 }
 bindSurfaceMaps(profile,resolution,loc){
  const g=this.gl,profileKey=surfaceProfileKey(profile);let entry=this.surfaceGpuTextures.get(profileKey+':'+resolution);
  if(!entry){let best=0;for(const [key,value] of this.surfaceGpuTextures){if(key.startsWith(profileKey+':')&&value.resolution<=resolution&&value.resolution>best){best=value.resolution;entry=value;}}}
  if(!entry){g.uniform1f(loc.uUseGeneratedMaps,0);return;}
  entry.used=++this.surfaceTextureClock;
  const blend=Math.max(0,Math.min(1,(performance.now()-entry.created)/450));
  const uniforms=[loc.uGeneratedAlbedo,loc.uGeneratedHeight,loc.uGeneratedRoughness,loc.uGeneratedNormal];
  for(let i=0;i<4;i++){g.activeTexture(g.TEXTURE4+i);g.bindTexture(g.TEXTURE_CUBE_MAP,entry.textures[i]);g.uniform1i(uniforms[i],4+i);}
  g.uniform1f(loc.uUseGeneratedMaps,blend);g.activeTexture(g.TEXTURE0);
 }
 dispose(){
  if(this.disposed)return;
  this.disposed=true;
  window.removeEventListener('graphics-settings-change',this.graphicsChangeHandler);
  const g=this.gl;
  for(const mesh of this.meshes??[])for(const buffer of mesh.buffers)g.deleteBuffer(buffer);
  if(this.lineBuffer)g.deleteBuffer(this.lineBuffer);
  for(const program of [this.bodyProgram,this.atmosphereProgram,this.cloudProgram,this.lineProgram])if(program)g.deleteProgram(program);
  this.hdr?.dispose();
  this.labels?.remove();
  this.labelNodes?.clear();
  this.orbitCache?.clear();
  for(const entry of this.surfaceGpuTextures?.values()??[])for(const texture of entry.textures)this.gl.deleteTexture(texture);
  this.surfaceGpuTextures?.clear();this.surfaceMapPending?.clear();this.surfaceUploadQueue?.splice(0);this.surfaceMapCache?.dispose();this.surfaceGpuBytes=0;
  this.stellarSourceDefinitions?.clear();
 }
}