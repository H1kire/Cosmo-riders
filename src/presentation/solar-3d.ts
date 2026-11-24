import { orbitalElementsToState } from '../physics/orbital-state.ts';
import { rotateStateToParentEquator } from '../physics/orbital-frame.ts';
import { RingRenderer } from '../rendering/rings/ring-renderer.ts';
import { AU } from '../physics/constants.ts';
import { LightingSystem, focusedSolarExposureMultiplier, planetaryDisplayGain } from '../rendering/lighting/lighting-system.ts';
import { HDRPipeline } from '../rendering/core/hdr-pipeline.ts';
import { createDefaultShaderLibrary } from '../rendering/shaders/index.ts';
import { ATMOSPHERE_VERTEX, ATMOSPHERE_FRAGMENT, CLOUD_VERTEX, CLOUD_FRAGMENT } from '../rendering/shaders/planet-effects.ts';
import { AtmosphereSystem } from '../rendering/atmosphere/atmosphere-system.ts';
import { CloudSystem } from '../rendering/atmosphere/cloud-system.ts';
import { createGraphicsSettings, type GraphicsSettings } from '../rendering/quality/quality-settings.ts';
import { selectMeshLod, planetaryOrbitOpacity, planetaryLabelOpacity, projectedOrbitRadius } from '../rendering/quality/render-lod.ts';
import { calculateEclipse } from '../rendering/lighting/eclipse-system.ts';
import { PLANET_SURFACE_VERTEX, PLANET_SURFACE_FRAGMENT } from '../rendering/shaders/planet-surface.ts';
import { GeodesicPlanetRenderer, type PlanetSurfaceMode } from '../rendering/geodesic/geodesic-planet-renderer.ts';
import type { SurfaceProfile } from '../rendering/geodesic/surface-tile.ts';

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
function bodyModelMatrix(body,radius,p,timeSeconds,state,parentState){
 const relativePosition=state&&parentState?[state.position.x-parentState.position.x,state.position.y-parentState.position.y,state.position.z-parentState.position.z]:null;
 const relativeVelocity=state&&parentState?[state.velocity.x-parentState.velocity.x,state.velocity.y-parentState.velocity.y,state.velocity.z-parentState.velocity.z]:null;
 const mapVector=v=>[v[0],v[2],v[1]];
 if(body.tidalLock&&relativePosition&&relativeVelocity){
  const orbitNormal=norm(mapVector(cross(relativePosition,relativeVelocity)));
  const towardParent=norm(mapVector([parentState.position.x-state.position.x,parentState.position.y-state.position.y,parentState.position.z-state.position.z]));
  const right=norm(cross(orbitNormal,towardParent));
  if(Math.hypot(...right)>0.5){
   const up=norm(cross(towardParent,right));
   return [right[0]*radius,up[0]*radius,towardParent[0]*radius,0,right[1]*radius,up[1]*radius,towardParent[1]*radius,0,right[2]*radius,up[2]*radius,towardParent[2]*radius,0,p[0],p[1],p[2],1];
  }
 }
 let spinAxis,forward;
 if(body.poleRightAscensionRad!==null&&body.poleRightAscensionRad!==undefined&&body.poleDeclinationRad!==null&&body.poleDeclinationRad!==undefined){
  const epsilon=23.4392911*Math.PI/180,ra=body.poleRightAscensionRad,dec=body.poleDeclinationRad;
  const equatorial=[Math.cos(dec)*Math.cos(ra),Math.cos(dec)*Math.sin(ra),Math.sin(dec)];
  const ecliptic=[equatorial[0],Math.cos(epsilon)*equatorial[1]+Math.sin(epsilon)*equatorial[2],-Math.sin(epsilon)*equatorial[1]+Math.cos(epsilon)*equatorial[2]];
  spinAxis=norm(mapVector(ecliptic));
  const equatorialNorth=mapVector([0,Math.sin(epsilon),Math.cos(epsilon)]);
  let reference=cross(equatorialNorth,spinAxis);
  if(Math.hypot(...reference)<1e-7){
   const axis=[1,0,0],projection=dot(axis,spinAxis);
   reference=axis.map((value,index)=>value-spinAxis[index]*projection);
  }
  forward=norm(reference);
 }else{
  const orbitNormal=relativePosition&&relativeVelocity?norm(mapVector(cross(relativePosition,relativeVelocity))):[0,1,0];
  const reference=[1,0,0],projection=dot(reference,orbitNormal);
  const orbitX=norm(reference.map((value,index)=>value-orbitNormal[index]*projection));
  const orbitY=norm(cross(orbitNormal,orbitX));
  const tilt=body.axialTiltRad??0;
  spinAxis=norm(orbitNormal.map((value,index)=>value*Math.cos(tilt)+orbitY[index]*Math.sin(tilt)));
  const projectionX=dot(orbitX,spinAxis);
  forward=norm(orbitX.map((value,index)=>value-spinAxis[index]*projectionX));
 }
 const right=norm(cross(spinAxis,forward));
 forward=norm(cross(right,spinAxis));
 const angle=body.rotationAngleAt?.(timeSeconds)??0,ca=Math.cos(angle),sa=Math.sin(angle);
 const rotatedRight=right.map((value,index)=>value*ca-forward[index]*sa);
 const rotatedForward=right.map((value,index)=>value*sa+forward[index]*ca);
 return [rotatedRight[0]*radius,spinAxis[0]*radius,rotatedForward[0]*radius,0,
  rotatedRight[1]*radius,spinAxis[1]*radius,rotatedForward[1]*radius,0,
  rotatedRight[2]*radius,spinAxis[2]*radius,rotatedForward[2]*radius,0,p[0],p[1],p[2],1];
}
function scaleModelMatrix(model,factor){return [model[0]*factor,model[1]*factor,model[2]*factor,0,model[4]*factor,model[5]*factor,model[6]*factor,0,model[8]*factor,model[9]*factor,model[10]*factor,0,model[12],model[13],model[14],1];}
function compile(gl,type,src){const s=gl.createShader(type);if(!s)throw Error('WebGL shader allocation failed');let source=src;if(typeof gl.createVertexArray==='function'){source=source.replace(/\battribute\b/g,'in').replace(/\bvarying\b/g,type===gl.VERTEX_SHADER?'out':'in');if(type===gl.FRAGMENT_SHADER&&source.includes('gl_FragColor')){source=source.replace(/(precision\s+\w+\s+float;)/,'$1\nout vec4 outColor;').replace(/gl_FragColor/g,'outColor');}source='#version 300 es\n'+source;}gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(s);gl.deleteShader(s);throw Error(error);}return s;}
function makeProgram(gl,vs,fs){const vertex=compile(gl,gl.VERTEX_SHADER,vs),fragment=compile(gl,gl.FRAGMENT_SHADER,fs),p=gl.createProgram();if(!p){gl.deleteShader(vertex);gl.deleteShader(fragment);throw Error('WebGL program allocation failed');}gl.attachShader(p,vertex);gl.attachShader(p,fragment);gl.linkProgram(p);gl.detachShader(p,vertex);gl.detachShader(p,fragment);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const error=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error(error);}return p;}
function makeSphere(gl,lat,lon){const p=[],n=[],idx=[];for(let y=0;y<=lat;y++){const v=y/lat,phi=v*Math.PI;for(let x=0;x<=lon;x++){const theta=x/lon*Math.PI*2,q=[-Math.cos(theta)*Math.sin(phi),Math.cos(phi),Math.sin(theta)*Math.sin(phi)];p.push(...q);n.push(...q);}}for(let y=0;y<lat;y++)for(let x=0;x<lon;x++){const a=y*(lon+1)+x,b=a+lon+1;idx.push(a,b,a+1,b,b+1,a+1);}const buffers=[gl.createBuffer(),gl.createBuffer(),gl.createBuffer()];gl.bindBuffer(gl.ARRAY_BUFFER,buffers[0]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(p),gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,buffers[1]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(n),gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,buffers[2]);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(idx),gl.STATIC_DRAW);return{buffers,count:idx.length};}

function earthSurfaceProfile(body):SurfaceProfile{
 const surface=body.surface??{},radius=body.meanRadiusM,mu=body.mu??3.986004418e14;
 return{
  bodyId:'earth',seed:body.surfaceSeed??surface.seed??1337,kind:'oceanic',
  massKg:body.massKg??mu/6.67430e-11,meanRadiusM:radius,gravityMS2:surface.gravityMS2??mu/(radius*radius),
  temperatureK:surface.temperatureK??288,pressurePa:surface.pressurePa??101325,
  waterFraction:surface.waterFraction??.71,iceFraction:surface.iceFraction??.025,
  ironFraction:surface.ironFraction??.32,silicateFraction:surface.silicateFraction??.62,
  volatileFraction:surface.volatileFraction??.03,sulfurFraction:surface.sulfurFraction??.01,
  tectonicActivity:surface.tectonicActivity??.8,volcanicActivity:surface.volcanicActivity??.32,
  erosion:surface.erosion??.78,age:surface.age??.18,
  rotationPeriodSeconds:body.rotationPeriodSeconds??86164,algorithmVersion:surface.algorithmVersion??1
 };
}

function loadGraphicsSettings():GraphicsSettings{
 try{const saved=JSON.parse(localStorage.getItem('cosmo-riders.graphics.v1')??'null') as Partial<GraphicsSettings>|null;const preset=saved&&['low','medium','high','ultra'].includes(saved.preset??'')?saved.preset!:'high';const base=createGraphicsSettings(preset);return saved?{...base,...saved,geodesic:base.geodesic}:base;}
 catch{return createGraphicsSettings('high');}
}
export class Solar3DView{
 [key: string]: any;
 constructor(canvas){
  this.canvas=canvas;
  this.gl=canvas.getContext('webgl2',{antialias:true,alpha:false,powerPreference:'high-performance'});
  if(!this.gl)throw Error('WebGL2 недоступен');
  const g=this.gl;
  this.graphics=loadGraphicsSettings();
  this.exposureCompensation=this.graphics.exposure;this.lastExposureUpdateMs=0;this.lastFrameDurationMs=0;this.averageFrameDurationMs=0;
  this.shaderLibrary=createDefaultShaderLibrary();
  this.hdr=new HDRPipeline(g,Math.max(1,canvas.width),Math.max(1,canvas.height),this.graphics.msaaSamples);
  this.applyGraphicsSettings(this.graphics);
  this.graphicsChangeHandler=(event:Event)=>{
    const value=(event as CustomEvent<Partial<GraphicsSettings>>).detail??{};const previousPreset=this.graphics.preset;
    this.graphics={...this.graphics,...value};this.applyGraphicsSettings(this.graphics);
    if(this.graphics.preset!==previousPreset)this.rebuildGeodesicRenderer(this.graphics);
  };
  window.addEventListener('graphics-settings-change',this.graphicsChangeHandler);
  this.bodyProgram=makeProgram(g,PLANET_SURFACE_VERTEX,PLANET_SURFACE_FRAGMENT);
  this.atmosphereProgram=makeProgram(g,ATMOSPHERE_VERTEX,this.shaderLibrary.compose(ATMOSPHERE_FRAGMENT));
  this.cloudProgram=makeProgram(g,CLOUD_VERTEX,this.shaderLibrary.compose(CLOUD_FRAGMENT));
  this.lineProgram=makeProgram(g,LINE_VERTEX,LINE_FRAGMENT);
  this.ringRenderer=new RingRenderer(g);
  this.earthRenderMode='auto' as PlanetSurfaceMode;this.geodesicEarthRenderer=null;this.geodesicEarthInitError=null;this.geodesicPreset=this.graphics.preset;this.rebuildGeodesicRenderer(this.graphics);
  this.meshes=[makeSphere(g,10,14),makeSphere(g,22,30),makeSphere(g,44,60),makeSphere(g,128,192)];
  this.lineBuffer=g.createBuffer();
  this.bodyLoc=this.locations(this.bodyProgram,['aPosition','aNormal','uViewProjection','uModel','uColor','uCameraPosition','uLightPositions[0]','uLightColors[0]','uLightIntensities[0]','uLightCount','uKind','uDetail','uSeed','uWaterFraction','uIceFraction','uIronFraction','uTectonicActivity','uVolcanicActivity','uErosion','uSunPosition','uSunRadius','uOccluders[0]','uOccluderRadii[0]','uOccluderCount','uShadows','uBodyExposure']);
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

 setEarthRenderMode(mode:PlanetSurfaceMode):void{this.earthRenderMode=mode;}
 rebuildGeodesicRenderer(settings:GraphicsSettings):void{
  this.geodesicEarthRenderer?.dispose();this.geodesicEarthRenderer=null;this.geodesicEarthInitError=null;this.geodesicPreset=settings.preset;
  const quality=settings.geodesic;
  try{this.geodesicEarthRenderer=new GeodesicPlanetRenderer(this.gl,{resolution:quality.pageResolution,meshResolution:quality.meshResolution,cpuBudgetBytes:quality.cpuBudgetBytes,gpuBudgetBytes:quality.gpuBudgetBytes,workerCount:quality.workerCount,maxUploadsPerFrame:quality.uploadsPerFrame});}
  catch(error){this.geodesicEarthInitError=error instanceof Error?error.message:String(error);}
 }
 getGraphicsDiagnostics(){
  const gl=this.gl,renderer=this.geodesicEarthRenderer,supported=gl.getSupportedExtensions()??[],mode=this.earthRenderMode??'auto';
  const active=mode==='uv'?'UV':renderer?.isReady?'Geodesic':'UV fallback';
  return{webgl2:true,maxArrayTextureLayers:Number(gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)),maxTextureSize:Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),maxVertexTextureImageUnits:Number(gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)),maxCombinedTextureImageUnits:Number(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)),maxVertexUniformVectors:Number(gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)),maxFragmentUniformVectors:Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)),maxVertexAttributes:Number(gl.getParameter(gl.MAX_VERTEX_ATTRIBS)),extensions:supported.filter(name=>name==='EXT_color_buffer_float'||name==='EXT_texture_filter_anisotropic'),mode,active,pageSize:renderer?.gpuPageSize??0,pageBytes:renderer?.gpuPageBytes??0,gpuCacheBytes:renderer?.gpuCacheBytes??0,gpuLayers:renderer?.gpuLayerCapacity??0,gpuResidentPages:renderer?.gpuResidentTileCount??0,gpuPinnedPages:renderer?.gpuPinnedPages??0,cpuCacheBytes:renderer?.cpuCacheBytes??0,cpuCachePages:renderer?.cpuCacheSize??0,generatedPages:renderer?.loadedTileCount??0,uploadedPages:renderer?.uploadedPageCount??0,workerCount:renderer?.workerCount??0,workerActive:renderer?.activeWorkerCount??0,workerQueued:renderer?.queuedCount??0,rendererErrors:(renderer?.errorCount??0)+(this.geodesicEarthInitError?1:0),uploadErrors:renderer?.uploadErrorCount??0,fallbackReason:active==='Geodesic'?'No fallback active':mode==='uv'?'UV mode selected':renderer?.fallbackReason??this.geodesicEarthInitError??'Geodesic renderer is unavailable.'};
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
   ['earth',110000,[.22,.48,1.0],.62,1.0],
   ['titan',400000,[.72,.43,.18],.96,1.25],
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
   ['earth',18000,.48,.82,5.8],
   ['titan',18000,.72,.62,3.8],
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
  g.uniform3f(l.uSunPosition,...this.currentSunPosition);g.uniform1f(l.uSunRadius,696340000/AU);g.uniform3fv(l['uOccluders[0]'],occluders.positions);g.uniform1fv(l['uOccluderRadii[0]'],occluders.radii);g.uniform1i(l.uOccluderCount,occluders.count);g.uniform1i(l.uShadows,this.graphics.shadows?1:0);g.uniform1f(l.uLightIntensity,light.intensity);this.bindMesh(mesh,l);g.drawElements(g.TRIANGLES,mesh.count,g.UNSIGNED_SHORT,0);
 }
 drawClouds(body,layers,p,radius,mesh,vp,light,occluders,timeSeconds,baseModel){
  const g=this.gl,l=this.cloudLoc;
  g.useProgram(this.cloudProgram);g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));
  g.uniform3f(l.uLightColor,...light.color);
  g.uniform1f(l.uTime,timeSeconds);g.uniform3f(l.uSunPosition,...this.currentSunPosition);g.uniform1f(l.uSunRadius,696340000/AU);g.uniform3fv(l['uOccluders[0]'],occluders.positions);g.uniform1fv(l['uOccluderRadii[0]'],occluders.radii);g.uniform1i(l.uOccluderCount,occluders.count);g.uniform1i(l.uShadows,this.graphics.shadows?1:0);g.uniform1f(l.uLightIntensity,light.intensity);
  for(const layer of layers){
   const shellRadius=radius*(1+layer.altitudeM/body.meanRadiusM);
   const model=scaleModelMatrix(baseModel,shellRadius/radius);
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
    if(Number.isFinite(nextDistance)){
      const focused=this.focusId?this.systemBodyById?.get(this.focusId):null;
      const minimum=focused?focused.meanRadiusM/AU*1.025:1e-8;
      this.distance=Math.max(minimum,Math.min(1e4,nextDistance));
    }
  },{passive:false});
  c.addEventListener('keydown',e=>{if(e.key==='Home')this.home();});
 }
 setEarthRenderMode(mode:PlanetSurfaceMode){this.earthRenderMode=mode;}
 getGeodesicEarthDiagnostics(){const renderer=this.geodesicEarthRenderer;return renderer?{ready:renderer.isReady,failed:renderer.isFailed,loaded:renderer.loadedTileCount,visible:renderer.visibleTileCount,gpuResident:renderer.gpuResidentTileCount,workers:renderer.workerCount,queued:renderer.queuedCount,cpuBytes:renderer.cpuCacheBytes,pinned:renderer.gpuPinnedPages,errors:renderer.errorCount}:{ready:false,failed:true,initError:this.geodesicEarthInitError??'Renderer unavailable'};}
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
 pick(e){const r=this.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=null,bestScore=Infinity;for(const [id,p] of this.projected){const hitRadius=Math.max(8,Math.min(72,p.projectedRadius??8));const d=Math.hypot(x-p.x,y-p.y),score=d/hitRadius;if(d<=hitRadius&&score<bestScore){bestScore=score;best=id;}}if(best){const item=this.projected.find(v=>v[0]===best),radius=item?.[1]?.radius??1e-5;this.focusId=best;this.focusOffset=[0,0,0];this.distance=Math.max(1e-10,radius*1.08);this.canvas.dispatchEvent(new CustomEvent('bodyselect',{detail:{id:best}}));}}
 project(vp,p,w,h){const[x,y,z]=p,cx=vp[0]*x+vp[4]*y+vp[8]*z+vp[12],cy=vp[1]*x+vp[5]*y+vp[9]*z+vp[13],cz=vp[2]*x+vp[6]*y+vp[10]*z+vp[14],cw=vp[3]*x+vp[7]*y+vp[11]*z+vp[15];return cw>0?{x:(cx/cw*.5+.5)*w,y:(1-(cy/cw*.5+.5))*h,z:cz/cw}:null;}
 drawOrbit(world,body,states,sunPosition,vp,mapper,opacity=1,eye,viewportHeight){
  if(!body.parentId||!body.orbitalElements||opacity<=0.005)return;
  const parent=world.bodies.get(body.parentId),parentState=states.get(body.parentId);if(!parent||!parentState)return;
  const parentPosition=mapper(parent,parentState.position),parentDistance=Math.hypot(parentPosition[0]-eye[0],parentPosition[1]-eye[1],parentPosition[2]-eye[2]);
  if(projectedOrbitRadius(body.orbitalElements.semiMajorAxisM/AU,viewportHeight,parentDistance)<0.12)return;
  let path=this.orbitCache.get(body.id);
  if(!path){path=[];for(let i=0;i<=192;i++){const e=body.orbitalElements;const state=rotateStateToParentEquator(orbitalElementsToState({...e,meanAnomaly:e.meanAnomaly+Math.PI*2*i/192},parent.mu+body.mu),body,parent);path.push(state.position);}this.orbitCache.set(body.id,path);}
  const data=[];for(const position of path){const absolute={x:parentState.position.x+position.x,y:parentState.position.y+position.y,z:parentState.position.z+position.z};const mapped=mapper(body,absolute);if(!mapped)return;data.push(...mapped);}
  const g=this.gl,l=this.lineLoc;g.useProgram(this.lineProgram);g.bindBuffer(g.ARRAY_BUFFER,this.lineBuffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array(data),g.DYNAMIC_DRAW);g.enableVertexAttribArray(l.aPosition);g.vertexAttribPointer(l.aPosition,3,g.FLOAT,false,0,0);g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));g.uniform4f(l.uColor,body.id==='earth'?.32:.18,body.id==='earth'?.58:.28,body.id==='earth'?.9:.42,.62*opacity);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);g.depthMask(false);g.drawArrays(g.LINE_STRIP,0,data.length/3);g.depthMask(true);g.disable(g.BLEND);
 }
 render(world,states,timeSeconds,vesselState=null){
  const frameStarted=performance.now();
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
  const sunState=states.get('sun')??{position:{x:0,y:0,z:0}};
  const sun=sunState.position,bodies=[...world.bodies.values()];
  this.systemBodyById=new Map(bodies.map(body=>[body.id,body]));
  if(!this.effectsConfigured){this.configurePlanetEffects();this.effectsConfigured=true;}
  const focus=this.focusId?world.bodies.get(this.focusId):null,focusState=focus?states.get(focus.id):null;
  const focusSunDistance=focusState?Math.hypot(focusState.position.x-sun.x,focusState.position.y-sun.y,focusState.position.z-sun.z)/AU:1;
  // Экспозиция кадра не зависит от фокуса; ослабление света учитывается отдельно на поверхности.
  this.exposureCompensation=this.graphics.exposure;
  this.lastExposureUpdateMs=frameStarted;
  this.hdr.settings.exposure=this.graphics.exposure;
  if(focusState){this.cameraOrigin=[0,0,0];this.target=this.focusOffset.slice();}
  else{this.cameraOrigin=[0,0,0];this.target=[0,0,0];}
  const eye=[this.target[0]+this.distance*Math.cos(this.pitch)*Math.sin(this.yaw),this.target[1]+this.distance*Math.sin(this.pitch),this.target[2]+this.distance*Math.cos(this.pitch)*Math.cos(this.yaw)];
  const focusRadius=focus?focus.meanRadiusM/AU:0;
  const far=100,near=Math.max(1e-10,Math.min(this.distance*.01,focusRadius>0?focusRadius*.02:this.distance*.01));
  const vp=multiply(perspective(Math.PI/3,w/h,near,far),lookAt(eye,this.target,[0,1,0]));
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
   const px=radius*(renderHeight/2)/(Math.tan(Math.PI/6)*Math.max(radius,viewDistance));
   const projectedScreen=this.project(vp,p,w/dpr,h/dpr);
   const level=selectMeshLod(px,this.graphics.maxMeshLod),mesh=this.meshes[level];
   
   const parentState=body.parentId?states.get(body.parentId):null;
   const model=bodyModelMatrix(body,radius,p,timeSeconds,state,parentState);
   g.uniformMatrix4fv(l.uModel,false,new Float32Array(model));
   const light=this.lighting.sampleAt(p,'sun');
   g.uniform3f(l.uCameraPosition,...eye);
   g.uniform3fv(l['uLightPositions[0]'],lightPositions);g.uniform3fv(l['uLightColors[0]'],lightColors);
   g.uniform1fv(l['uLightIntensities[0]'],lightIntensities);g.uniform1i(l.uLightCount,lightSources.length);
   const isStar=!body.parentId;
    const bodySunDistanceAU=Math.hypot(state.position.x-sun.x,state.position.y-sun.y,state.position.z-sun.z)/AU;
    const bodyExposure=isStar?1:planetaryDisplayGain(bodySunDistanceAU);
    g.uniform1f(l.uBodyExposure,bodyExposure);
    g.uniform3f(l.uColor,...(COLORS[body.id]??(isStar?[1,.72,.42]:[.5,.6,.8])));
    g.uniform1f(l.uKind,isStar?6:(KINDS[body.id]??2));
    g.uniform1f(l.uDetail,Math.min(TEXTURE_DETAIL_CAPS[this.graphics.textureQuality]??1,Math.max(0,Math.min(1.5,Math.log2(Math.max(1,px)/18)/4))));
    g.uniform1f(l.uSeed,body.surfaceSeed??0);
    g.uniform1f(l.uWaterFraction,isStar?0:(body.surface?.waterFraction??0));
    g.uniform1f(l.uIceFraction,isStar?0:(body.surface?.iceFraction??0));
    g.uniform1f(l.uIronFraction,isStar?0:(body.surface?.ironFraction??0));
    g.uniform1f(l.uTectonicActivity,isStar?0:(body.surface?.tectonicActivity??0));
    g.uniform1f(l.uVolcanicActivity,isStar?0:(body.surface?.volcanicActivity??0));
    g.uniform1f(l.uErosion,isStar?0:(body.surface?.erosion??0));
   g.uniform3f(l.uSunPosition,...sunRenderPosition);g.uniform1f(l.uSunRadius,696340000/AU);
   const occluders=this.collectOccluders(body,state,sunState,bodies,states,renderOrigin);
   g.uniform3fv(l['uOccluders[0]'],occluders.positions);g.uniform1fv(l['uOccluderRadii[0]'],occluders.radii);
   g.uniform1i(l.uOccluderCount,occluders.count);g.uniform1i(l.uShadows,this.graphics.shadows?1:0);
   let renderedGeodesicEarth=false;
   if(body.id==='earth'&&this.geodesicEarthRenderer&&this.earthRenderMode!=='uv'){
    if(!this.geodesicEarthRenderer.isReady&&!this.geodesicEarthRenderer.isFailed){
     try{this.geodesicEarthRenderer.setPlanetSurface(earthSurfaceProfile(body));}catch(error){this.geodesicEarthInitError=error instanceof Error?error.message:String(error);}
    }
    if(!this.geodesicEarthRenderer.isFailed){
     renderedGeodesicEarth=this.geodesicEarthRenderer.render({model,viewProjection:vp,cameraPosition:eye,lightPositions,lightColors,lightIntensities,lightCount:lightSources.length,bodyExposure,sunPosition:sunRenderPosition,sunRadius:696340000/AU,occluderPositions:occluders.positions,occluderRadii:occluders.radii,occluderCount:occluders.count,shadowsEnabled:this.graphics.shadows});
    }
   }
   if(!renderedGeodesicEarth){g.useProgram(this.bodyProgram);this.bindMesh(mesh,l);g.drawElements(g.TRIANGLES,mesh.count,g.UNSIGNED_SHORT,0);}
   if(body.hasRings)this.ringRenderer.render(vp,scaleModelMatrix(model,this.ringRenderer.outerScale(body.id)),body.id);
   const profile=this.atmosphereSystem.getProfile(body.id);
   const cloudLayers=this.cloudSystem.getLayers(body.id);
   if(this.graphics.atmosphere&&profile){
    g.enable(g.CULL_FACE);g.cullFace(g.BACK);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE);g.depthMask(false);
    this.drawAtmosphere(body,profile,p,radius,mesh,vp,eye,light,occluders);
    g.depthMask(true);g.disable(g.BLEND);g.disable(g.CULL_FACE);
   }
   if(this.graphics.clouds&&cloudLayers.length){
    g.enable(g.CULL_FACE);g.cullFace(g.BACK);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);g.depthMask(false);
    this.drawClouds(body,cloudLayers,p,radius,mesh,vp,light,occluders,timeSeconds,model);
    g.depthMask(true);g.disable(g.BLEND);g.disable(g.CULL_FACE);
   }
   const screen=projectedScreen;
   if(screen&&screen.z>=-1&&screen.z<=1&&screen.x>=-20&&screen.x<=w/dpr+20&&screen.y>=-20&&screen.y<=h/dpr+20)this.projected.push([body.id,{...screen,world:p,radius,projectedRadius:px,viewDistance,labelOpacity:planetaryLabelOpacity(viewDistance,radius)}]);
  }
  g.useProgram(this.bodyProgram);g.uniformMatrix4fv(l.uViewProjection,false,new Float32Array(vp));
  // Корабль временно исключён из сцены: активна только Солнечная система.
  const labelCandidates=this.projected.filter(([id,p])=>{const body=world.bodies.get(id);return Boolean(body&&(!body.parentId||(p.projectedRadius??0)>=9));}).sort((a,b)=>Number(Boolean(world.bodies.get(b[0])?.parentId===null))-Number(Boolean(world.bodies.get(a[0])?.parentId===null))+(b[1].projectedRadius??0)-(a[1].projectedRadius??0));
  const occupied=[] as {left:number;top:number;right:number;bottom:number}[];
  const offsets=[[12,-13],[12,5],[-12,-13],[-12,5],[0,-23],[0,15]];
  const visibleLabels=new Set<string>();
  for(const [id,p] of labelCandidates){const body=world.bodies.get(id);if(!body)continue;let node=this.labelNodes.get(id);if(!node){node=document.createElement('span');node.className='body-label';this.labels.append(node);this.labelNodes.set(id,node);}node.textContent=body.name;const width=Math.max(34,body.name.length*6.4),height=14;let chosen=null;for(const [dx,dy] of offsets){const left=p.x+dx-(dx<0?width:0),top=p.y+dy,rect={left:left-4,top:top-3,right:left+width+4,bottom:top+height+3};if(rect.left<4||rect.top<4||rect.right>w/dpr-4||rect.bottom>h/dpr-4)continue;if(occupied.every(other=>rect.right<other.left||rect.left>other.right||rect.bottom<other.top||rect.top>other.bottom)){chosen=[left,top];occupied.push(rect);break;}}if(chosen){node.hidden=false;node.style.opacity=String(p.labelOpacity??1);node.style.transform='translate3d('+Math.round(chosen[0])+'px,'+Math.round(chosen[1])+'px,0)';visibleLabels.add(id);}else node.hidden=true;}
  for(const [id,node] of this.labelNodes)if(!visibleLabels.has(id))node.hidden=true;
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
  this.lastFrameDurationMs=performance.now()-frameStarted;
  this.averageFrameDurationMs=this.averageFrameDurationMs?this.averageFrameDurationMs*.9+this.lastFrameDurationMs*.1:this.lastFrameDurationMs;
  if(frameStarted-(this.lastDiagnosticsPublish??0)>=500){this.lastDiagnosticsPublish=frameStarted;window.dispatchEvent(new CustomEvent('graphics-diagnostics',{detail:this.getGraphicsDiagnostics()}));}
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
  this.ringRenderer?.dispose();
  this.geodesicEarthRenderer?.dispose();
  this.labels?.remove();
  this.labelNodes?.clear();
  this.orbitCache?.clear();
  this.stellarSourceDefinitions?.clear();
 }
}