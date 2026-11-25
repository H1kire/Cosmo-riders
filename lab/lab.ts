import { createSolarSystemWorld, SOLAR_SYSTEM_DATA } from '../src/physics/solar-system.ts';
import { AU } from '../src/physics/constants.ts';
import { add, magnitude, normalize, scale, subtract, vector3 } from '../src/physics/vector3.ts';
import { stateToOrbitalElements, orbitalPeriod } from '../src/physics/orbital-elements.ts';
import { executeIdealizedBurn, thrustToWeightRatio } from '../src/physics/propulsion.ts';
import { hohmannTransfer } from '../src/physics/maneuvers.ts';
import { orbitalElementsToState } from '../src/physics/orbital-state.ts';
import { rotateStateToParentEquator } from '../src/physics/orbital-frame.ts';
import { Solar3DView } from '../src/presentation/solar-3d.ts';
import { formatDisplayNumber } from './preferences.ts';

const reportLoading=(id:string,complete=false)=>window.dispatchEvent(new CustomEvent('cosmo-loading-stage',{detail:{id,complete}}));
reportLoading('application');
// Yield once so the browser can paint the loading overlay before scene construction.
await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
reportLoading('webgl');

const $ = (id: string): (HTMLElement & { value: string }) | null => document.getElementById(id) as (HTMLElement & { value: string }) | null;
const canvases = { solar: $('solar-view'), lunar: $('lunar-view'), vessel: $('vessel-view') };
let solar3D: Solar3DView | null = null;
let fallbackCanvas: HTMLCanvasElement | null = null;
function activateSolarFallback(error: unknown) {
  console.error('Не удалось запустить 3D-карту:', error);
  const parent = canvases.solar.parentElement;
  if (!parent) return;
  let notice = parent.querySelector<HTMLElement>('.render-error');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'render-error';
    parent.append(notice);
  }
  const message = error instanceof Error ? error.message : String(error ?? 'неизвестная ошибка');
  notice.textContent = '3D-режим недоступен — включена резервная карта: ' + message;
  const webgl2Available=!/WebGL2.*недоступен/i.test(message);
  window.dispatchEvent(new CustomEvent('graphics-diagnostics',{detail:{
    webgl2:webgl2Available,maxArrayTextureLayers:'—',maxTextureSize:'—',
    maxVertexTextureImageUnits:'—',maxFragmentTextureImageUnits:'—',maxCombinedTextureImageUnits:'—',
    maxVertexUniformVectors:'—',maxFragmentUniformVectors:'—',maxVertexAttributes:'—',
    extensions:[],mode:'auto',active:'Canvas 2D fallback',pageSize:'—',pageBytes:'—',
    gpuCacheBytes:'—',gpuLayers:'—',gpuResidentPages:'—',gpuPinnedPages:'—',
    cpuCacheBytes:'—',cpuCachePages:'—',generatedPages:'—',uploadedPages:'—',
    workerCount:'—',workerActive:'—',workerQueued:'—',rendererErrors:'—',uploadErrors:'—',
    fallbackReason:message
  }}));
  if (!fallbackCanvas) {
    fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.className = 'solar-fallback';
    fallbackCanvas.setAttribute('aria-label', 'Резервная карта Солнечной системы');
    parent.append(fallbackCanvas);
  }
}
try {
  solar3D = new Solar3DView(canvases.solar);
  await solar3D.ready;
  reportLoading('webgl',true);reportLoading('solar-system');reportLoading('renderer',true);
} catch (error) {
  solar3D?.dispose();solar3D=null;
  activateSolarFallback(error);
}
const DAY = 86400;
const ENGINE = Object.freeze({ vacuumThrustN: 200000, seaLevelThrustN: 180000, ispSeconds: 340 });
const SHIP_DRY_MASS_KG = 7000;
let world, vessel, paused = false, lastFrame = 0, trail = [];
let renderedBodyStates = null, renderedVesselState = null;
let focusBodyId = null, pendingGlobalTransition = false;
let selectedBodyId: string|null = null;
const LOCAL_VIEW_START_ZOOM = 2500;
const orbitPathCache = new Map();
const cameraZoom = { solar: 1, lunar: 0.34, vessel: 1 };
const cameraTargetZoom = { solar: 1, lunar: 0.34, vessel: 1 };
const cameraPan = { x: 0, y: 0 };
const cameraTargetPan = { x: 0, y: 0 };
let selectedPlanetId = null;
let trackingTargetId = null;
let highestWindowZ = 50;
const MIN_ZOOM = 0.08, MAX_ZOOM = 1e8, ZOOM_FACTOR = 1.22;
const PLANET_IDS = ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'];
const PLANET_COLORS = { mercury:'#a6a6a6',venus:'#e5bd82',earth:'#5b9dff',mars:'#df806b',jupiter:'#d8a77c',saturn:'#d8ca9b',uranus:'#81d9dd',neptune:'#6089ed' };
const fmt = (value,digits=2) => formatDisplayNumber(value,digits);
const distanceLabel = metres => metres >= 1e9 ? fmt(metres/1e9,3)+' млн км' : metres >= 1e6 ? fmt(metres/1e6,2)+' тыс. км' : fmt(metres/1e3,1)+' км';
const speedLabel = value => fmt(value/1000,3)+' км/с';
const getBody = id => renderedBodyStates?.get(id) ?? world.getBodyState(id);
const getRenderedVessel = () => renderedVesselState ?? world.getVesselState('test-vessel');
const body = id => world.bodies.get(id);
const currentPrimary = () => body(vessel.primaryBodyId);
const currentPrimaryState = () => getBody(vessel.primaryBodyId);

function renderSystemNavigation(){
  const nav=$('system-navigation');
  if(!nav||!world)return;
  nav.replaceChildren();
  const roots=[...world.bodies.values()].filter(item=>!item.parentId);
  for(const star of roots){
    const entries=[star,...[...world.bodies.values()].filter(item=>item.parentId===star.id)];
    for(const item of entries){
      const button=document.createElement('button');
      button.type='button';button.className='system-nav-item'+(item.id===selectedPlanetId?' active':'');
      button.dataset.bodyId=item.id;
      button.title='Перейти к '+item.name;
      button.textContent=item.parentId?item.name:(item.id==='sun'?'☼ '+item.name:'★ '+item.name);
      button.addEventListener('click',()=>{
        selectedPlanetId=item.id;
        selectedBodyId=item.id;
        solar3D?.focusOn(item.id,world);
        updatePlanetInformation();
        renderSystemNavigation();
      });
      nav.append(button);
    }
  }
}
function updatePlanetInformation(){
  const host=$('planet-info');
  if(!host||!vessel||!world)return;
  const item=(selectedBodyId?world.bodies.get(selectedBodyId):null)??world.bodies.get('earth')??currentPrimary();
  if(!item){host.textContent='Нет данных о выбранном небесном теле.';return;}
  const parent=item.parentId?body(item.parentId):null;
  const children=[...world.bodies.values()].filter(candidate=>candidate.parentId===item.id);
  const volume=4*Math.PI*Math.pow(item.meanRadiusM,3)/3;
  const density=item.massKg/volume;
  const gravity=item.mu/(item.meanRadiusM*item.meanRadiusM);
  const elements=item.orbitalElements;
  const period=elements&&parent?orbitalPeriod(elements.semiMajorAxisM,parent.mu+item.mu):null;
  const environment=item.surface??null;
  const rotationPeriod=item.rotationPeriodSeconds??(item.tidalLock&&period?period:null);
  const formatPeriod=(seconds:number|null)=>seconds===null?'Нет достоверных данных':seconds>=DAY?fmt(seconds/DAY,4)+' суток':fmt(seconds/3600,3)+' ч';
  const tilt=item.axialTiltRad;
  const retrograde=tilt!==null&&tilt!==undefined?tilt>Math.PI/2:(item.tidalLock&&(elements?.inclination??0)>Math.PI/2);
  const atmosphere=environment?.pressurePa===0?'Практически отсутствует':item.atmosphereComposition.length?item.atmosphereComposition.join(', '):'Нет достоверных данных';
  const pressureLabel=['jupiter','saturn','uranus','neptune'].includes(item.id)?'Опорное давление (1 бар)':'Атмосферное давление';
  const rows=[
    ['Название',item.name],['Тип объекта',!parent?'Звезда':parent.parentId===null?'Планета':'Естественный спутник'],['Родительское тело',parent?.name??'—'],
    ['Масса',fmt(item.massKg,4)+' кг'],['Средний радиус',distanceLabel(item.meanRadiusM)],
    ['Экваториальный радиус',item.equatorialRadiusM?distanceLabel(item.equatorialRadiusM):'Нет данных'],
    ['Диаметр',distanceLabel(item.meanRadiusM*2)],['Средняя плотность',fmt(density,1)+' кг/м³'],
    ['Ускорение свободного падения',fmt(gravity,4)+' м/с²'],
    ['Орбитальный период',period?formatPeriod(period):'Нет орбиты / данные отсутствуют'],
    ['Большая полуось',elements?distanceLabel(elements.semiMajorAxisM):'Нет данных'],
    ['Эксцентриситет',elements?fmt(elements.eccentricity,7):'Нет данных'],
    ['Наклонение орбиты',elements?fmt(elements.inclination*180/Math.PI,4)+'°':'Нет данных'],
    ['Сидерический период вращения',formatPeriod(rotationPeriod)],
    ['Направление вращения',rotationPeriod===null?'Не определено':retrograde?'Ретроградное':'Прямое'],
    ['Наклон оси вращения',tilt!==null&&tilt!==undefined?fmt(tilt*180/Math.PI,3)+'°':'Нет достоверных данных'],
    ['Продолжительность солнечных суток',formatPeriod(item.solarDaySeconds??null)],
    ['Средняя температура',environment?.temperatureK!==undefined?fmt(environment.temperatureK,1)+' K':'Нет достоверных данных'],
    [pressureLabel,environment?.pressurePa!==undefined?fmt(environment.pressurePa,4)+' Па':'Нет достоверных данных'],
    ['Состав атмосферы',atmosphere],['Наличие колец',item.hasRings?'Да':'Нет'],
    ['Спутники в модели',String(children.length)]
  ];
  host.replaceChildren();
  const heading=document.createElement('div');heading.className='planet-info-heading';heading.textContent=item.name;host.append(heading);
  const grid=document.createElement('div');grid.className='data-list';
  for(const [label,value] of rows){const row=document.createElement('div');const a=document.createElement('span'),b=document.createElement('b');a.textContent=label;b.textContent=value;row.append(a,b);grid.append(row);}
  host.append(grid);
}
function createScenario(name) {
  // Кеплеровская пропагация аналитическая, поэтому для лабораторной сцены
  // используем шаг 60 с: это резко сокращает число одинаковых пересчётов эфемерид.
  world = createSolarSystemWorld({fixedStepSeconds:60,maxSubSteps:2000});
  selectedBodyId='earth';selectedPlanetId='earth';
  const earth = getBody('earth'), moon = getBody('moon');
  const earthMu = body('earth').mu, moonMu = body('moon').mu;
  if (name === 'moon-approach') {
    const moonSoi = world.getSphereOfInfluence('moon');
    const offset = vector3(moonSoi*0.72,0,0);
    vessel = world.addVessel({id:'test-vessel',primaryBodyId:'earth',position:add(moon.position,offset),velocity:add(moon.velocity,vector3(0,180,0)),massKg:12000});
  } else if (name === 'moon-orbit') {
    const radius = 2_000_000;
    vessel = world.addVessel({id:'test-vessel',primaryBodyId:'moon',position:add(moon.position,vector3(radius,0,0)),velocity:add(moon.velocity,vector3(0,Math.sqrt(moonMu/radius),0)),massKg:12000});
  } else {
    const radius = 7_000_000;
    vessel = world.addVessel({id:'test-vessel',primaryBodyId:'earth',position:add(earth.position,vector3(radius,0,0)),velocity:add(earth.velocity,vector3(0,Math.sqrt(earthMu/radius),0)),massKg:12000});
  }
  trail = [];
  renderedBodyStates=null;renderedVesselState=null;
  updateTelemetry();
  renderSystemNavigation();
  updatePlanetInformation();
  drawAll();
}

function resizeCanvas(canvas) {
  const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
  const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,width:rect.width,height:rect.height};
}
function point(ctx,x,y,r,color,glow=false) {
  ctx.save();ctx.fillStyle=color;if(glow){ctx.shadowBlur=13;ctx.shadowColor=color;}
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();
}
function ring(ctx,x,y,r,color,dash=[5,5],alpha=.7) {
  ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=alpha;ctx.lineWidth=1;ctx.setLineDash(dash);
  ctx.beginPath();ctx.arc(x,y,Math.max(1,r),0,Math.PI*2);ctx.stroke();ctx.restore();
}
function label(ctx,text,x,y,color='#9aabc2',font='10px Segoe UI,Arial') {
  ctx.save();ctx.fillStyle=color;ctx.font=font;ctx.fillText(text,x,y);ctx.restore();
}
function getOrbitPath(id){
  if(orbitPathCache.has(id))return orbitPathCache.get(id);
  const celestial=body(id);
  if(!celestial?.parentId||!celestial.orbitalElements){orbitPathCache.set(id,[]);return [];}
  const parent=body(celestial.parentId),elements=celestial.orbitalElements,points=[],segments=128;
  for(let i=0;i<=segments;i++){
    const sample=rotateStateToParentEquator(orbitalElementsToState({...elements,meanAnomaly:elements.meanAnomaly+2*Math.PI*i/segments},parent.mu+celestial.mu),celestial,parent);
    points.push(sample.position);
  }
  orbitPathCache.set(id,points);
  return points;
}
function globalSolarMapPoint(position,width,height,zoom=cameraZoom.solar,includePan=true){
  const sun=getBody('sun'),dx=position.x-sun.position.x,dy=position.y-sun.position.y;
  const distance=Math.hypot(dx,dy);
  if(distance===0)return {x:width*.5+(includePan?cameraPan.x:0),y:height*.5+(includePan?cameraPan.y:0)};
  const maxRadius=SOLAR_SYSTEM_DATA.neptune.elements.semiMajorAxisM;
  const maxPx=Math.min(width*.43,height*.42),denominator=Math.log1p(maxRadius/AU);
  const shownRadius=Math.log1p(distance/AU)/denominator*maxPx*zoom;
  return {x:width*.5+(includePan?cameraPan.x:0)+dx/distance*shownRadius,
    y:height*.5+(includePan?cameraPan.y:0)-dy/distance*shownRadius};
}
function globalPixelsPerMetre(distance,width,height,zoom=cameraZoom.solar){
  const maxPx=Math.min(width*.43,height*.42);
  const denominator=Math.log1p(SOLAR_SYSTEM_DATA.neptune.elements.semiMajorAxisM/AU);
  return maxPx*zoom/(denominator*(AU+Math.max(0,distance)));
}
function drawGlobalOrbit(ctx,id,width,height){
  const celestial=body(id),parentState=getBody(celestial.parentId),path=getOrbitPath(id);
  if(!path.length)return;
  ctx.beginPath();
  for(let i=0;i<path.length;i++){
    const p=globalSolarMapPoint({x:parentState.position.x+path[i].x,y:parentState.position.y+path[i].y,z:parentState.position.z+path[i].z},width,height);
    if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);
  }
  ctx.strokeStyle=id===selectedPlanetId?'#9bd5ff':'#22364e';
  ctx.lineWidth=id===selectedPlanetId?2.2:1;
  ctx.globalAlpha=id===selectedPlanetId?.95:.58;
  ctx.setLineDash(id===selectedPlanetId?[]:[2,6]);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
}
function drawGlobalSolar(ctx,width,height){
  const sun=getBody('sun'),maxPx=Math.min(width*.43,height*.42);
  const center={x:width*.5+cameraPan.x,y:height*.5+cameraPan.y};
  for(const id of PLANET_IDS)drawGlobalOrbit(ctx,id,width,height);
  const sunRadius=Math.max(5,Math.min(90,695700000*globalPixelsPerMetre(0,width,height)));
  point(ctx,center.x,center.y,sunRadius,'#ffd27b',true);
  label(ctx,'СОЛНЦЕ',center.x+sunRadius+5,center.y-10,'#ffdc9b','9px Segoe UI,Arial');
  for(const id of PLANET_IDS){
    const state=getBody(id),data=SOLAR_SYSTEM_DATA[id],screen=globalSolarMapPoint(state.position,width,height);
    if(screen.x < -100 || screen.x > width+100 || screen.y < -100 || screen.y > height+100)continue;
    const distance=Math.hypot(state.position.x-sun.position.x,state.position.y-sun.position.y);
    const radius=Math.max(2.4,Math.min(90,data.meanRadiusM*globalPixelsPerMetre(distance,width,height)));
    if(id===selectedPlanetId)ring(ctx,screen.x,screen.y,radius+7,'#b8e4ff',[],.9);
    point(ctx,screen.x,screen.y,radius,PLANET_COLORS[id],id===selectedPlanetId||id==='earth');
    label(ctx,data.name,screen.x+radius+5,screen.y-5,PLANET_COLORS[id],'9px Segoe UI,Arial');
  }
  const ship=getRenderedVessel(),shipPoint=globalSolarMapPoint(ship.position,width,height);
  if(shipPoint.x>=-20&&shipPoint.x<=width+20&&shipPoint.y>=-20&&shipPoint.y<=height+20)point(ctx,shipPoint.x,shipPoint.y,3,'#fff',true);
  if(cameraZoom.solar<100)label(ctx,'30 AU',center.x+maxPx*.83*cameraZoom.solar,center.y+13,'#647f9d','9px Segoe UI,Arial');
}
function localMapPoint(id,width,height,includePan=true){
  if(!focusBodyId)return null;
  const focus=body(focusBodyId),focusState=getBody(focusBodyId),target=body(id);
  if(!target)return null;
  if(id!==focusBodyId&&target.parentId!==focusBodyId&&focus.parentId!==id)return null;
  const targetState=getBody(id),dx=targetState.position.x-focusState.position.x,dy=targetState.position.y-focusState.position.y;
  const sun=getBody('sun'),focusDistance=Math.hypot(focusState.position.x-sun.position.x,focusState.position.y-sun.position.y);
  const scale=globalPixelsPerMetre(focusDistance,width,height,cameraZoom.solar);
  return {x:width*.5+(includePan?cameraPan.x:0)+dx*scale,
    y:height*.5+(includePan?cameraPan.y:0)-dy*scale,scale};
}
function drawLocalOrbit(ctx,childId,parentId,width,height,scale){
  const parentPoint=localMapPoint(parentId,width,height),path=getOrbitPath(childId);
  if(!parentPoint||!path.length)return;
  const radius=body(childId).semiMajorAxisM*scale;
  if(radius>Math.max(width,height)*3)return;
  ctx.beginPath();
  for(let i=0;i<path.length;i++){
    const x=parentPoint.x+path[i].x*scale,y=parentPoint.y-path[i].y*scale;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
  ctx.strokeStyle='#9fb5d0';ctx.globalAlpha=.72;ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
}
function drawLocalSolar(ctx,width,height){
  const focus=body(focusBodyId),focusState=getBody(focusBodyId),sun=getBody('sun');
  const focusDistance=Math.hypot(focusState.position.x-sun.position.x,focusState.position.y-sun.position.y);
  const scale=globalPixelsPerMetre(focusDistance,width,height,cameraZoom.solar);
  const center={x:width*.5+cameraPan.x,y:height*.5+cameraPan.y};
  const visibleIds=[focusBodyId];
  if(focus.parentId)visibleIds.push(focus.parentId);
  for(const candidate of world.bodies.values())if(candidate.parentId===focusBodyId)visibleIds.push(candidate.id);
  if(focus.parentId)drawLocalOrbit(ctx,focusBodyId,focus.parentId,width,height,scale);
  for(const candidate of world.bodies.values())if(candidate.parentId===focusBodyId)drawLocalOrbit(ctx,candidate.id,focusBodyId,width,height,scale);
  for(const id of visibleIds){
    const data=SOLAR_SYSTEM_DATA[id]??body(id),screen=id===focusBodyId?center:localMapPoint(id,width,height);
    if(!screen||screen.x < -width*2||screen.x > width*3||screen.y < -height*2||screen.y > height*3)continue;
    const radius=Math.max(1.4,data.meanRadiusM*scale);
    if(id===selectedPlanetId)ring(ctx,screen.x,screen.y,Math.min(radius+7,Math.max(width,height)),'#e1f1ff',[],.9);
    const color=PLANET_COLORS[id]??(id==='moon'?'#c5cfdb':'#ffd27b');
    point(ctx,screen.x,screen.y,radius,color,radius<35);
    if(radius<55)label(ctx,data.name,screen.x+radius+5,screen.y-5,color,'10px Segoe UI,Arial');
  }
  const ship=getRenderedVessel(),shipState=ship.position;
  const dx=shipState.x-focusState.position.x,dy=shipState.y-focusState.position.y;
  const shipX=center.x+dx*scale,shipY=center.y-dy*scale;
  if(shipX>=-20&&shipX<=width+20&&shipY>=-20&&shipY<=height+20)point(ctx,shipX,shipY,3,'#fff',true);
  label(ctx,'ЛОКАЛЬНАЯ СИСТЕМА · '+focus.name.toUpperCase(),14,24,'#a9caff','10px Segoe UI,Arial');
}
function drawFallbackSolar() {
  if (!fallbackCanvas) return;
  const rect = fallbackCanvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (fallbackCanvas.width !== width || fallbackCanvas.height !== height) {
    fallbackCanvas.width = width;
    fallbackCanvas.height = height;
  }
  const ctx = fallbackCanvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  drawGlobalSolar(ctx, rect.width, rect.height);
}
function drawSolar(){
  if (solar3D) {
    try {
      solar3D.render(world, renderedBodyStates ?? world.bodyStates, world.simulationTimeSeconds, null);
      return;
    } catch (error) {
      solar3D = null;
      activateSolarFallback(error);
    }
  }
  drawFallbackSolar();
}
function drawLunar() {
  const {ctx,width:w,height:h}=resizeCanvas(canvases.lunar);ctx.clearRect(0,0,w,h);
  const cx=w*.5,cy=h*.51,moonDistance=SOLAR_SYSTEM_DATA.moon.elements.semiMajorAxisM;
  const px=Math.min(w*.31,h*.34)/moonDistance*cameraZoom.lunar;
  const earth=getBody('earth'),moon=getBody('moon'),dx=(moon.position.x-earth.position.x)*px,dy=-(moon.position.y-earth.position.y)*px;
  const mx=cx+dx,my=cy+dy,earthSoi=world.getSphereOfInfluence('earth'),moonSoi=world.getSphereOfInfluence('moon');
  ring(ctx,cx,cy,earthSoi*px,'#6c9cff',[5,5],.4);
  ctx.save();ctx.strokeStyle='#526780';ctx.setLineDash([3,5]);ctx.beginPath();ctx.ellipse(cx,cy,moonDistance*px,moonDistance*px*.97,0,0,Math.PI*2);ctx.stroke();ctx.restore();
  ring(ctx,mx,my,moonSoi*px,'#83e0b0',[3,4],.9);
  point(ctx,cx,cy,7,'#5b9dff',true);point(ctx,mx,my,4,'#c5cfdb',true);
  label(ctx,'Земля',cx+11,cy-10,'#a9caff');label(ctx,'Луна',mx+9,my-8,'#d9e4f0');
  const ship=getRenderedVessel(),sx=cx+(ship.position.x-earth.position.x)*px,sy=cy-(ship.position.y-earth.position.y)*px;
  point(ctx,sx,sy,3,'#fff',true);
}
function drawVessel() {
  const {ctx,width:w,height:h}=resizeCanvas(canvases.vessel);ctx.clearRect(0,0,w,h);
  const primary=currentPrimary(),primaryState=currentPrimaryState(),ship=getRenderedVessel();
  const relative=subtract(ship.position,primaryState.position),radius=magnitude(relative),soi=world.getSphereOfInfluence(primary.id);
  const scaleDistance=Math.max(radius*2.4,primary.meanRadiusM*100),px=Math.min(w*.38,h*.38)/scaleDistance*cameraZoom.vessel,cx=w*.5,cy=h*.52;
  if(soi)ring(ctx,cx,cy,soi*px,'#6c9cff',[5,5],.7);
  ring(ctx,cx,cy,radius*px,'#536c8a',[2,5],.8);
  if(trail.length>1){
    ctx.save();ctx.strokeStyle='#d9f5ff';ctx.lineWidth=1.4;ctx.lineCap='round';
    for(let i=1;i<trail.length;i++){
      const a=trail[i-1],b=trail[i],alpha=Math.max(0,1-(performance.now()-b.time)/1000);
      if(alpha<=0)continue;ctx.globalAlpha=.6*alpha;ctx.beginPath();ctx.moveTo(cx+a.x*px,cy-a.y*px);ctx.lineTo(cx+b.x*px,cy-b.y*px);ctx.stroke();
    }ctx.restore();
  }
  point(ctx,cx,cy,primary.id==='sun'?7:6,primary.id==='earth'?'#5b9dff':primary.id==='moon'?'#c5cfdb':'#ffd27b',true);
  point(ctx,cx+relative.x*px,cy-relative.y*px,4,'#fff',true);
  label(ctx,primary.name,cx+11,cy-10,'#c3d8f0');label(ctx,'RIDER-01',cx+relative.x*px+8,cy-relative.y*px-8,'#fff','9px Segoe UI,Arial');
  $('detail-scale').textContent='АКТИВНЫЙ ЦЕНТР · '+primary.name.toUpperCase();
}
function updateZoomLabels(){
  for(const view of Object.keys(cameraZoom)){
    const output=$('zoom-value-'+view);
    if(output)output.textContent=view==='solar'?fmt((solar3D?.distance ?? 38),4)+' AU':Math.round(cameraZoom[view]*100)+'%';
  }
}
function solarMapPoint(id,includePan=true,zoom=cameraZoom.solar){
  const canvas=canvases.solar,width=canvas.clientWidth,height=canvas.clientHeight;
  if(focusBodyId&&zoom>=LOCAL_VIEW_START_ZOOM){
    const focus=body(focusBodyId),target=body(id);
    if(!target)return null;
    if(id!==focusBodyId&&target.parentId!==focusBodyId&&focus.parentId!==id)return null;
    const focusState=getBody(focusBodyId),targetState=getBody(id),sun=getBody('sun');
    const distance=Math.hypot(focusState.position.x-sun.position.x,focusState.position.y-sun.position.y);
    const scale=globalPixelsPerMetre(distance,width,height,zoom);
    return {x:width*.5+(includePan?cameraPan.x:0)+(targetState.position.x-focusState.position.x)*scale,
      y:height*.5+(includePan?cameraPan.y:0)-(targetState.position.y-focusState.position.y)*scale};
  }
  const state=getBody(id);
  return globalSolarMapPoint(state.position,width,height,zoom,includePan);
}
function findMapBodyAt(x,y){
  let nearest=null,nearestDistance=Infinity;
  const ids=focusBodyId&&cameraZoom.solar>=LOCAL_VIEW_START_ZOOM
    ? [focusBodyId,...(focusBodyId?Array.from((world.bodies as Map<string, { id: string; parentId: string | null }>).values()).filter(item=>item.parentId===focusBodyId||item.id===body(focusBodyId).parentId).map(item=>item.id):[])]
    : PLANET_IDS;
  for(const id of ids){
    const p=solarMapPoint(id);
    if(!p)continue;
    const data=SOLAR_SYSTEM_DATA[id]??body(id),hitRadius=Math.max(12,Math.min(28,4+data.meanRadiusM/1e6));
    const distance=Math.hypot(x-p.x,y-p.y);
    if(distance<hitRadius&&distance<nearestDistance){nearest=id;nearestDistance=distance;}
  }
  return nearest;
}
function globalPointForBody(id,zoom=cameraZoom.solar){
  const state=getBody(id),canvas=canvases.solar;
  return globalSolarMapPoint(state.position,canvas.clientWidth,canvas.clientHeight,zoom,false);
}
function setSolarZoom(nextZoom,anchorX=canvases.solar.clientWidth*.5,anchorY=canvases.solar.clientHeight*.5){
  const clamped=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,nextZoom));
  const cx=canvases.solar.clientWidth*.5,cy=canvases.solar.clientHeight*.5;
  if(!focusBodyId&&clamped>=LOCAL_VIEW_START_ZOOM){
    const target=findMapBodyAt(anchorX,anchorY)??selectedPlanetId;
    if(target&&PLANET_IDS.includes(target)){
      focusBodyId=target;
      const point=globalPointForBody(target,cameraZoom.solar);
      cameraTargetPan.x=cx-point.x;cameraTargetPan.y=cy-point.y;
      pendingGlobalTransition=false;
    }
  }
  if(focusBodyId&&cameraZoom.solar>=LOCAL_VIEW_START_ZOOM&&clamped<LOCAL_VIEW_START_ZOOM)pendingGlobalTransition=true;
  if(focusBodyId&&clamped>=LOCAL_VIEW_START_ZOOM)pendingGlobalTransition=false;
  const oldZoom=cameraTargetZoom.solar,ratio=clamped/oldZoom;
  const worldX=anchorX-cx-cameraTargetPan.x,worldY=anchorY-cy-cameraTargetPan.y;
  cameraTargetPan.x=anchorX-cx-worldX*ratio;
  cameraTargetPan.y=anchorY-cy-worldY*ratio;
  cameraTargetZoom.solar=clamped;
}
function changeZoom(view,direction){
  if(!(view in cameraZoom))return;
  if(view==='solar')setSolarZoom(cameraTargetZoom.solar*(direction>0?ZOOM_FACTOR:1/ZOOM_FACTOR));
  else cameraTargetZoom[view]=Math.min(64,Math.max(.08,cameraTargetZoom[view]*(direction>0?ZOOM_FACTOR:1/ZOOM_FACTOR)));
  drawAll();
}
function resetZoom(view){
  if(!(view in cameraZoom))return;
  cameraTargetZoom[view]=view==='lunar'?.34:1;
  if(view==='solar'){cameraTargetPan.x=cameraTargetPan.y=0;cameraPan.x=cameraPan.y=0;focusBodyId=null;pendingGlobalTransition=false;trackingTargetId=null;selectedPlanetId=null;}
  drawAll();
}
function bindCameraControls(view){
  canvases[view].addEventListener('wheel',event=>{
    event.preventDefault();
    if(view==='solar'){
      const rect=canvases.solar.getBoundingClientRect();
      setSolarZoom(cameraTargetZoom.solar*(event.deltaY<0?ZOOM_FACTOR:1/ZOOM_FACTOR),event.clientX-rect.left,event.clientY-rect.top);
    }else changeZoom(view,event.deltaY<0?1:-1);
  },{passive:false});
  document.querySelectorAll<HTMLElement>('[data-zoom-view="'+view+'"]').forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.zoomAction;
    if(action==='in')changeZoom(view,1);
    else if(action==='out')changeZoom(view,-1);
    else if(action==='reset')resetZoom(view);
  }));
}
for(const view of ['lunar','vessel'])bindCameraControls(view);

// The 3D renderer owns solar-camera input; legacy 2D map handlers are intentionally removed.
function drawAll(){
  drawSolar();
  // Дополнительные сцены не перерисовываются, пока их окна закрыты.
  if($('window-local').style.display==='block')drawLunar();
  if($('window-ship').style.display==='block')drawVessel();
  updateZoomLabels();
}

document.querySelectorAll<HTMLElement>('[data-zoom-view="solar"]').forEach(button=>button.addEventListener('click',()=>{const action=button.dataset.zoomAction;if(action==='in')solar3D && (solar3D.distance=Math.max(1e-10,solar3D.distance/1.22));else if(action==='out'){const nextDistance=(solar3D?.distance ?? 86)*1.22;if(solar3D&&Number.isFinite(nextDistance))solar3D.distance=nextDistance;}updateZoomLabels();}));
$('camera-home').addEventListener('click',()=>{
  resetZoom('solar');
  solar3D?.home();
  trackingTargetId=null;
  selectedPlanetId=null;
  selectedBodyId=null;
  focusBodyId=null;pendingGlobalTransition=false;
  drawAll();
});

// Independent utility windows can be opened, closed and dragged by their title bars.
function openWindow(id){
  const sidebarWidth=document.querySelector<HTMLElement>('.sidebar').getBoundingClientRect().width;
  document.querySelectorAll<HTMLElement>('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.openWindow===id));

  // The solar system is the permanent main view, not a floating window.
  if(id==='window-system'){
    document.querySelectorAll<HTMLElement>('.floating-window').forEach(win=>{win.style.display='none';});
    requestAnimationFrame(()=>drawAll());
    return;
  }

  const win=$(id);
  if(!win)return;
  win.style.display='block';
  const rect=win.getBoundingClientRect();
  const minX=sidebarWidth+8;
  const maxX=Math.max(minX,window.innerWidth-rect.width-8);
  win.style.left=Math.max(minX,Math.min(maxX,parseFloat(win.style.left)||minX+16))+'px';
  win.style.top=Math.max(66,Math.min(window.innerHeight-rect.height-8,parseFloat(win.style.top)||90))+'px';
  win.style.zIndex=String(++highestWindowZ);
  requestAnimationFrame(()=>drawAll());
}
document.querySelectorAll<HTMLElement>('[data-open-window]').forEach(button=>button.addEventListener('click',()=>openWindow(button.dataset.openWindow)));
document.querySelectorAll<HTMLElement>('.floating-window').forEach(win=>{
  win.querySelector<HTMLElement>('.window-close').addEventListener('click',()=>{
    win.style.display='none';
    document.querySelectorAll<HTMLElement>('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.openWindow==='window-system'));
  });
  win.addEventListener('pointerdown',()=>{win.style.zIndex=String(++highestWindowZ);});
  const bar=win.querySelector<HTMLElement>('.window-titlebar');
  let drag=null;
  bar.addEventListener('pointerdown',event=>{
    if((event.target as Element).closest('button'))return;
    const rect=win.getBoundingClientRect();
    drag={pointerId:event.pointerId,x:event.clientX-rect.left,y:event.clientY-rect.top};
    bar.setPointerCapture(event.pointerId);win.style.zIndex=String(++highestWindowZ);
  });
  bar.addEventListener('pointermove',event=>{
    if(!drag||drag.pointerId!==event.pointerId)return;
    const minX=document.querySelector<HTMLElement>('.sidebar').getBoundingClientRect().width+4;
    const maxX=Math.max(minX,window.innerWidth-win.offsetWidth-8),maxY=Math.max(62,window.innerHeight-52);
    win.style.left=Math.max(minX,Math.min(maxX,event.clientX-drag.x))+'px';
    win.style.top=Math.max(62,Math.min(maxY,event.clientY-drag.y))+'px';
  });
  const end=()=>{drag=null;};
  bar.addEventListener('pointerup',end);bar.addEventListener('pointercancel',end);
});

function updateTelemetry(){
  if(!vessel)return;
  const primary=currentPrimary(),state=currentPrimaryState(),relativePosition=subtract(vessel.position,state.position),relativeVelocity=subtract(vessel.velocity,state.velocity);
  const r=magnitude(relativePosition),v=magnitude(relativeVelocity),elements=stateToOrbitalElements(relativePosition,relativeVelocity,primary.mu);
  const period=elements.trajectoryType==='elliptic'?orbitalPeriod(elements.semiMajorAxis,primary.mu):null,soi=world.getSphereOfInfluence(primary.id);
  $('primary-badge').textContent=primary.name;$('distance-value').textContent=distanceLabel(r);$('speed-value').textContent=speedLabel(v);
  $('period-value').textContent=period?fmt(period/DAY,3)+' суток':'не замкнута';$('eccentricity-value').textContent=fmt(elements.eccentricity,6);
  $('soi-value').textContent=soi?distanceLabel(soi):'—';
  $('switch-value').textContent=vessel.lastPrimarySwitch?body(vessel.lastPrimarySwitch.from).name+' → '+body(vessel.lastPrimarySwitch.to).name:'Не было';
  $('clock-value').textContent='J2000.0 + '+fmt(world.simulationTimeSeconds/DAY,5)+' суток';
  updatePlanetInformation();
  $('mass-value').textContent=fmt(vessel.massKg,1)+' кг';
  $('twr-value').textContent=fmt(thrustToWeightRatio(ENGINE.vacuumThrustN,vessel.massKg,9.80665),2)+' : 1';
}
function applyPoweredBurn(deltaVMS){
  // Ручной импульс разрешён только на штатной скорости симуляции.
  world.setTimeScale(1);
  $('time-scale').value='1';
  const primaryState=currentPrimaryState(),relativeVelocity=subtract(vessel.velocity,primaryState.velocity);
  let direction=normalize(relativeVelocity);if(deltaVMS<0)direction=scale(direction,-1);
  try{
    const result=executeIdealizedBurn(world,'test-vessel',{direction,deltaVMS:Math.abs(deltaVMS),engine:ENGINE,dryMassKg:SHIP_DRY_MASS_KG});
    $('burn-status').textContent='Включение: '+fmt(result.burnDurationSeconds,2)+' с · топливо: '+fmt(result.propellantUsedKg,2)+' кг · Δv '+fmt(Math.abs(deltaVMS),1)+' м/с';
    updateTelemetry();drawAll();
  }catch(error){$('burn-status').textContent='ОТКАЗ ДВИГАТЕЛЯ: '+error.message;}
}
function updateManeuverPlanner(){
  const transfer=hohmannTransfer({primaryMu:body('sun').mu,initialRadiusM:SOLAR_SYSTEM_DATA.earth.elements.semiMajorAxisM,targetRadiusM:SOLAR_SYSTEM_DATA.mars.elements.semiMajorAxisM});
  $('hohmann-departure').textContent=fmt(transfer.departureDeltaVMS/1000,3)+' км/с';
  $('hohmann-arrival').textContent=fmt(transfer.arrivalDeltaVMS/1000,3)+' км/с';
  $('hohmann-total').textContent=fmt(transfer.totalDeltaVMS/1000,3)+' км/с';
  $('hohmann-time').textContent=fmt(transfer.transferTimeSeconds/DAY,1)+' суток';
}
let lastTelemetryUpdate=0,firstFrameReported=false;
function animate(timestamp){
  if(!lastFrame)lastFrame=timestamp;
  const delta=Math.min((timestamp-lastFrame)/1000,.1);
  lastFrame=timestamp;
  const oldLength=trail.length;
  trail=trail.filter(point=>timestamp-point.time<=1000);
  const expired=oldLength!==trail.length;
  let advanced=false;
  if(!paused){
    const oldPrimary=vessel.primaryBodyId,steps=world.advance(delta);
    if(steps>0){
      if(vessel.primaryBodyId!==oldPrimary)trail=[];
      const s=world.getVesselState('test-vessel'),p=world.getBodyState(vessel.primaryBodyId);
      trail.push({x:s.position.x-p.position.x,y:s.position.y-p.position.y,time:timestamp});
      if(timestamp-lastTelemetryUpdate>=250){updateTelemetry();lastTelemetryUpdate=timestamp;}
      advanced=true;
    }
  }

  const renderTime=world.simulationTimeSeconds+(!paused?world.accumulator:0);
  renderedBodyStates=world.getBodyStatesAt(renderTime);
  renderedVesselState=world.getVesselStateAt('test-vessel',renderTime,renderedBodyStates);

  const previousZoom=cameraZoom.solar;
  const cameraEase=1-Math.exp(-12*delta);
  const zoomDifference=Math.abs(cameraTargetZoom.solar-cameraZoom.solar);
  cameraZoom.solar+=(cameraTargetZoom.solar-cameraZoom.solar)*cameraEase;
  if(focusBodyId&&previousZoom<LOCAL_VIEW_START_ZOOM&&cameraZoom.solar>=LOCAL_VIEW_START_ZOOM){
    cameraPan.x=cameraPan.y=0;cameraTargetPan.x=cameraTargetPan.y=0;
  }
  if(focusBodyId&&pendingGlobalTransition&&cameraZoom.solar<LOCAL_VIEW_START_ZOOM){
    const point=globalPointForBody(focusBodyId,cameraZoom.solar);
    cameraTargetPan.x=canvases.solar.clientWidth*.5-point.x;
    cameraTargetPan.y=canvases.solar.clientHeight*.5-point.y;
    cameraPan.x=cameraTargetPan.x;cameraPan.y=cameraTargetPan.y;
    focusBodyId=null;pendingGlobalTransition=false;
  }
  if(trackingTargetId){
    const target=solarMapPoint(trackingTargetId,false,cameraTargetZoom.solar);
    if(target){
      cameraTargetPan.x=canvases.solar.clientWidth*.5-target.x;
      cameraTargetPan.y=canvases.solar.clientHeight*.5-target.y;
    }
  }
  cameraPan.x+=(cameraTargetPan.x-cameraPan.x)*cameraEase;
  cameraPan.y+=(cameraTargetPan.y-cameraPan.y)*cameraEase;
  for(const view of ['lunar','vessel'])cameraZoom[view]+=(cameraTargetZoom[view]-cameraZoom[view])*cameraEase;
  const cameraMoving=zoomDifference>1e-5||Math.abs(cameraTargetPan.x-cameraPan.x)>.05||Math.abs(cameraTargetPan.y-cameraPan.y)>.05;
  drawAll();
  if(!firstFrameReported){firstFrameReported=true;reportLoading('first-frame',true);}

  renderedBodyStates=null;
  renderedVesselState=null;
  requestAnimationFrame(animate);
reportLoading('solar-system',true);
}
$('scenario').addEventListener('change',event=>{createScenario((event.target as HTMLInputElement).value);});
$('time-scale').addEventListener('change',event=>world.setTimeScale(Number((event.target as HTMLInputElement).value)));
solar3D?.canvas.addEventListener('bodyselect',event=>{
  selectedBodyId=(event as CustomEvent<{id:string}>).detail?.id??null;
  selectedPlanetId=selectedBodyId;
  updatePlanetInformation();
  renderSystemNavigation();
});
$('pause-button').addEventListener('click',()=>{paused=!paused;world.setPaused(paused);$('pause-button').textContent=paused?'▶ Продолжить':'Ⅱ Пауза';});
$('step-button').addEventListener('click',()=>{if(!paused){paused=true;world.setPaused(true);$('pause-button').textContent='▶ Продолжить';}world.step();updateTelemetry();drawAll();});
$('reset-button').addEventListener('click',()=>{paused=false;world.setPaused(false);$('pause-button').textContent='Ⅱ Пауза';createScenario($('scenario').value);});
$('retro-button').addEventListener('click',()=>applyPoweredBurn(-10));
$('pro-button').addEventListener('click',()=>applyPoweredBurn(10));
window.addEventListener('resize',drawAll);

window.addEventListener('number-format-change',()=>{updateTelemetry();drawAll();});
createScenario('earth-orbit');
world.setTimeScale(Number($('time-scale').value));
updateManeuverPlanner();
requestAnimationFrame(animate);
