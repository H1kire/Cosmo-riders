import { createSolarSystemWorld, SOLAR_SYSTEM_DATA } from '../src/physics/solar-system.js';
import { AU } from '../src/physics/constants.js';
import { add, magnitude, normalize, scale, subtract, vector3 } from '../src/physics/vector3.js';
import { stateToOrbitalElements, orbitalPeriod } from '../src/physics/orbital-elements.js';
import { executeIdealizedBurn, thrustToWeightRatio } from '../src/physics/propulsion.js';
import { hohmannTransfer } from '../src/physics/maneuvers.js';

const $ = id => document.getElementById(id);
const canvases = { solar: $('solar-view'), lunar: $('lunar-view'), vessel: $('vessel-view') };
const DAY = 86400;
const ENGINE = Object.freeze({ vacuumThrustN: 200000, seaLevelThrustN: 180000, ispSeconds: 340 });
const SHIP_DRY_MASS_KG = 7000;
let world, vessel, paused = false, lastFrame = 0, trail = [];
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
const fmt = (value,digits=2) => Number.isFinite(value) ? new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits}).format(value) : '—';
const distanceLabel = metres => metres >= 1e9 ? fmt(metres/1e9,3)+' млн км' : metres >= 1e6 ? fmt(metres/1e6,2)+' тыс. км' : fmt(metres/1e3,1)+' км';
const speedLabel = value => fmt(value/1000,3)+' км/с';
const getBody = id => world.getBodyState(id);
const body = id => world.bodies.get(id);
const currentPrimary = () => body(vessel.primaryBodyId);
const currentPrimaryState = () => getBody(vessel.primaryBodyId);

function createScenario(name) {
  // Кеплеровская пропагация аналитическая, поэтому для лабораторной сцены
  // используем шаг 60 с: это резко сокращает число одинаковых пересчётов эфемерид.
  world = createSolarSystemWorld({fixedStepSeconds:60,maxSubSteps:2000});
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
  updateTelemetry();
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
function drawSolar() {
  const {ctx,width:w,height:h}=resizeCanvas(canvases.solar);
  ctx.clearRect(0,0,w,h);
  const sun=getBody('sun'),maxRadius=SOLAR_SYSTEM_DATA.neptune.elements.semiMajorAxisM;
  const maxPx=Math.min(w*.43,h*.42),cx=w*.5+cameraPan.x,cy=h*.5+cameraPan.y;
  const logDenominator=Math.log1p(maxRadius/AU);
  const displayRadius=distance=>Math.log1p(Math.max(0,distance)/AU)/logDenominator*maxPx*cameraZoom.solar;
  const pixelsPerMetre=distance=>maxPx*cameraZoom.solar/(logDenominator*(AU+Math.max(0,distance)));
  const bodyScreen={};
  ctx.save();
  for(const id of PLANET_IDS){
    const data=SOLAR_SYSTEM_DATA[id],a=data.elements.semiMajorAxisM,e=data.elements.eccentricity,r=displayRadius(a);
    // Не строим орбиты, заведомо находящиеся далеко за пределами экрана.
    if(r>Math.max(w,h)*2.5)continue;
    ctx.beginPath();ctx.ellipse(cx-r*e,cy,r,r*Math.sqrt(1-e*e),0,0,Math.PI*2);
    ctx.strokeStyle=id===selectedPlanetId?'#9bd5ff':'#22364e';
    ctx.lineWidth=id===selectedPlanetId?2.2:1;
    ctx.globalAlpha=id===selectedPlanetId ? 0.95 : 0.65;
    ctx.setLineDash(id===selectedPlanetId?[]:[2,6]);ctx.stroke();
  }
  ctx.restore();

  point(ctx,cx,cy,Math.max(5,Math.min(695700000*pixelsPerMetre(0),90)),'#ffd27b',true);
  label(ctx,'СОЛНЦЕ',cx+10,cy-10,'#ffdc9b','9px Segoe UI,Arial');

  for(const id of PLANET_IDS){
    const state=getBody(id),data=SOLAR_SYSTEM_DATA[id];
    const dx=state.position.x-sun.position.x,dy=state.position.y-sun.position.y;
    const actualRadius=Math.hypot(dx,dy),shownRadius=displayRadius(actualRadius);
    const x=cx+dx/actualRadius*shownRadius,y=cy-dy/actualRadius*shownRadius;
    // Тела за пределами экрана не требуют отрисовки и эффектов свечения.
    if(x < -100 || x > w+100 || y < -100 || y > h+100)continue;
    const physicalRadius=data.meanRadiusM*pixelsPerMetre(actualRadius);
    const radius=Math.max(2.4,Math.min(90,physicalRadius));
    bodyScreen[id]={x,y,radius};
    if(id===selectedPlanetId){
      ctx.save();ctx.strokeStyle='#b8e4ff';ctx.globalAlpha=.9;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(x,y,radius+7,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
    point(ctx,x,y,radius,PLANET_COLORS[id],id===selectedPlanetId||id==='earth');
    label(ctx,data.name,x+radius+5,y-5,PLANET_COLORS[id],'9px Segoe UI,Arial');
  }

  // At close zoom, reveal the Earth-Moon system as a local-scale inset on the same map.
  if(cameraZoom.solar>=1e6 && bodyScreen.earth){
    const earth=getBody('earth'),moon=getBody('moon'),earthScreen=bodyScreen.earth;
    const earthDistance=Math.hypot(earth.position.x-sun.position.x,earth.position.y-sun.position.y);
    const localScale=pixelsPerMetre(earthDistance);
    const orbitRadius=SOLAR_SYSTEM_DATA.moon.elements.semiMajorAxisM*localScale;
    if(orbitRadius>2){
      ctx.save();ctx.strokeStyle='#b6c9df';ctx.globalAlpha=.65;ctx.lineWidth=1;
      ctx.setLineDash([3,4]);ctx.beginPath();ctx.arc(earthScreen.x,earthScreen.y,orbitRadius,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
    const moonPoint=solarMoonScreenPoint(earthScreen,w,h);
    ring(ctx,earthScreen.x,earthScreen.y,moonPoint.orbitRadius,'#b6c9df',[3,5],.75);
    if(selectedPlanetId==='moon'){
      ctx.save();ctx.strokeStyle='#e4f1ff';ctx.lineWidth=1.5;ctx.beginPath();
      ctx.arc(moonPoint.x,moonPoint.y,moonPoint.radius+6,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
    bodyScreen.moon=moonPoint;
    point(ctx,moonPoint.x,moonPoint.y,moonPoint.radius,'#c5cfdb',true);
    label(ctx,'ЛУНА',moonPoint.x+moonPoint.radius+4,moonPoint.y-4,'#d9e4f0','9px Segoe UI,Arial');
  }

  const ship=world.getVesselState('test-vessel');
  const sx=ship.position.x-sun.position.x,sy=ship.position.y-sun.position.y,shipRadius=Math.hypot(sx,sy);
  const shipShown=displayRadius(shipRadius),shipX=cx+sx/shipRadius*shipShown,shipY=cy-sy/shipRadius*shipShown;
  if(shipX>=-20&&shipX<=w+20&&shipY>=-20&&shipY<=h+20)point(ctx,shipX,shipY,3,'#fff',true);
  if(cameraZoom.solar<100)label(ctx,'30 AU',cx+maxPx*.83*cameraZoom.solar,cy+13,'#647f9d','9px Segoe UI,Arial');
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
  const ship=world.getVesselState('test-vessel'),sx=cx+(ship.position.x-earth.position.x)*px,sy=cy-(ship.position.y-earth.position.y)*px;
  point(ctx,sx,sy,3,'#fff',true);
}
function drawVessel() {
  const {ctx,width:w,height:h}=resizeCanvas(canvases.vessel);ctx.clearRect(0,0,w,h);
  const primary=currentPrimary(),primaryState=currentPrimaryState(),ship=world.getVesselState('test-vessel');
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
    if(output)output.textContent=view==='solar'?fmt(cameraTargetZoom[view],2)+'×':Math.round(cameraZoom[view]*100)+'%';
  }
}
function solarMapPoint(id){
  const canvas=canvases.solar,w=canvas.clientWidth,h=canvas.clientHeight;
  if(id==='moon'&&cameraZoom.solar>=1e6){
    const earthPoint=solarMapPoint('earth'),sun=getBody('sun'),earth=getBody('earth');
    const maxRadius=SOLAR_SYSTEM_DATA.neptune.elements.semiMajorAxisM;
    const maxPx=Math.min(w*.43,h*.42);
    const earthDistance=Math.hypot(earth.position.x-sun.position.x,earth.position.y-sun.position.y);
    const earthRadius=Math.max(2.4,Math.min(90,SOLAR_SYSTEM_DATA.earth.meanRadiusM*
      maxPx*cameraZoom.solar/(Math.log1p(maxRadius/AU)*(AU+earthDistance))));
    return solarMoonScreenPoint({...earthPoint,radius:earthRadius},w,h);
  }
  const sun=getBody('sun'),state=getBody(id),maxRadius=SOLAR_SYSTEM_DATA.neptune.elements.semiMajorAxisM;
  const maxPx=Math.min(w*.43,h*.42);
  const distance=Math.hypot(state.position.x-sun.position.x,state.position.y-sun.position.y);
  const radius=Math.log1p(distance/AU)/Math.log1p(maxRadius/AU)*maxPx*cameraZoom.solar;
  return {x:w*.5+cameraPan.x+(state.position.x-sun.position.x)/distance*radius,
    y:h*.5+cameraPan.y-(state.position.y-sun.position.y)/distance*radius};
}
function solarMoonScreenPoint(earthScreen,width,height){
  const earth=getBody('earth'),moon=getBody('moon');
  const dx=moon.position.x-earth.position.x,dy=moon.position.y-earth.position.y;
  const angle=Math.atan2(dy,dx);
  // Масштаб спутника условный: иначе реальная орбита Луны теряется на масштабе всей Солнечной системы.
  const orbitRadius=Math.min(Math.max(earthScreen.radius*60,26),Math.min(width,height)*.32);
  return {x:earthScreen.x+Math.cos(angle)*orbitRadius,y:earthScreen.y-Math.sin(angle)*orbitRadius,
    radius:Math.max(2.2,Math.min(8,orbitRadius*.035)),orbitRadius};
}
function findMapBodyAt(x,y){
  let nearest=null,nearestDistance=Infinity;
  const ids=cameraZoom.solar>=1e6? [...PLANET_IDS,'moon']:PLANET_IDS;
  for(const id of ids){
    const p=solarMapPoint(id),distance=Math.hypot(x-p.x,y-p.y);
    const hitRadius=id==='moon'?16:Math.max(12,Math.min(28,4+SOLAR_SYSTEM_DATA[id].meanRadiusM/1e6));
    if(distance<hitRadius&&distance<nearestDistance){nearest=id;nearestDistance=distance;}
  }
  return nearest;
}
function setSolarZoom(nextZoom,anchorX=canvases.solar.clientWidth*.5,anchorY=canvases.solar.clientHeight*.5){
  const oldZoom=cameraTargetZoom.solar;
  const ratio=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,nextZoom))/oldZoom;
  const cx=canvases.solar.clientWidth*.5,cy=canvases.solar.clientHeight*.5;
  const worldX=anchorX-cx-cameraTargetPan.x,worldY=anchorY-cy-cameraTargetPan.y;
  cameraTargetPan.x=anchorX-cx-worldX*ratio;
  cameraTargetPan.y=anchorY-cy-worldY*ratio;
  cameraTargetZoom.solar=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,nextZoom));
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
  if(view==='solar')cameraTargetPan.x=cameraTargetPan.y=0;
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
  document.querySelectorAll('[data-zoom-view="'+view+'"]').forEach(button=>button.addEventListener('click',()=>{
    const action=button.dataset.zoomAction;
    if(action==='in')changeZoom(view,1);
    else if(action==='out')changeZoom(view,-1);
    else if(action==='reset')resetZoom(view);
  }));
}
for(const view of Object.keys(canvases))bindCameraControls(view);

// Smooth camera easing and click-vs-drag detection for the solar map.
{
  const canvas=canvases.solar;
  let pointer=null,moved=false;
  canvas.addEventListener('contextmenu',event=>{
    event.preventDefault();
    trackingTargetId=null;
  });
  canvas.addEventListener('pointerdown',event=>{
    if(event.button===2){trackingTargetId=null;return;}
    if(event.button!==0)return;
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY};
    moved=false;canvas.classList.add('dragging');canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!pointer||pointer.id!==event.pointerId)return;
    const dx=event.clientX-pointer.lastX,dy=event.clientY-pointer.lastY;
    if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>4)moved=true;
    if(moved){cameraTargetPan.x+=dx;cameraTargetPan.y+=dy;}
    pointer.lastX=event.clientX;pointer.lastY=event.clientY;
  });
  const stop=event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    if(!moved){
      const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
      selectedPlanetId=findMapBodyAt(x,y);
    }
    pointer=null;canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
  canvas.addEventListener('dblclick',event=>{
    const rect=canvas.getBoundingClientRect();
    const target=findMapBodyAt(event.clientX-rect.left,event.clientY-rect.top);
    if(!target)return;
    selectedPlanetId=target;
    trackingTargetId=target;
    const point=solarMapPoint(target);
    cameraTargetPan.x+=canvas.clientWidth*.5-point.x;
    cameraTargetPan.y+=canvas.clientHeight*.5-point.y;
    drawAll();
  });
}
function drawAll(){
  drawSolar();
  // Дополнительные сцены не перерисовываются, пока их окна закрыты.
  if($('window-local').style.display==='block')drawLunar();
  if($('window-ship').style.display==='block')drawVessel();
  updateZoomLabels();
}

$('camera-home').addEventListener('click',()=>{
  resetZoom('solar');
  trackingTargetId=null;
  selectedPlanetId=null;
  drawAll();
});

// Independent utility windows can be opened, closed and dragged by their title bars.
function openWindow(id){
  const sidebarWidth=document.querySelector('.sidebar').getBoundingClientRect().width;
  document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.openWindow===id));

  // The solar system is the permanent main view, not a floating window.
  if(id==='window-system'){
    document.querySelectorAll('.floating-window').forEach(win=>{win.style.display='none';});
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
document.querySelectorAll('[data-open-window]').forEach(button=>button.addEventListener('click',()=>openWindow(button.dataset.openWindow)));
document.querySelectorAll('.floating-window').forEach(win=>{
  win.querySelector('.window-close').addEventListener('click',()=>{
    win.style.display='none';
    document.querySelectorAll('.nav-item').forEach(button=>button.classList.toggle('active',button.dataset.openWindow==='window-system'));
  });
  win.addEventListener('pointerdown',()=>{win.style.zIndex=String(++highestWindowZ);});
  const bar=win.querySelector('.window-titlebar');
  let drag=null;
  bar.addEventListener('pointerdown',event=>{
    if(event.target.closest('button'))return;
    const rect=win.getBoundingClientRect();
    drag={pointerId:event.pointerId,x:event.clientX-rect.left,y:event.clientY-rect.top};
    bar.setPointerCapture(event.pointerId);win.style.zIndex=String(++highestWindowZ);
  });
  bar.addEventListener('pointermove',event=>{
    if(!drag||drag.pointerId!==event.pointerId)return;
    const minX=document.querySelector('.sidebar').getBoundingClientRect().width+4;
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
  $('model-primary').textContent=primary.name;
  $('mass-value').textContent=fmt(vessel.massKg,1)+' кг';
  $('twr-value').textContent=fmt(thrustToWeightRatio(ENGINE.vacuumThrustN,vessel.massKg,9.80665),2)+' : 1';
}
function applyPoweredBurn(deltaVMS){
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
let lastTelemetryUpdate=0;
function animate(timestamp){
  if(!lastFrame)lastFrame=timestamp;const delta=Math.min((timestamp-lastFrame)/1000,.1);lastFrame=timestamp;
  const oldLength=trail.length;trail=trail.filter(point=>timestamp-point.time<=1000);const expired=oldLength!==trail.length;
  let advanced=false;
  if(!paused){
    const oldPrimary=vessel.primaryBodyId,steps=world.advance(delta);
    if(steps>0){
      if(vessel.primaryBodyId!==oldPrimary)trail=[];
      const s=world.getVesselState('test-vessel'),p=currentPrimaryState();
      trail.push({x:s.position.x-p.position.x,y:s.position.y-p.position.y,time:timestamp});
      if(timestamp-lastTelemetryUpdate>=250){updateTelemetry();lastTelemetryUpdate=timestamp;}
      advanced=true;
    }
  }
  const cameraEase=1-Math.exp(-12*delta);
  const zoomDifference=Math.abs(cameraTargetZoom.solar-cameraZoom.solar);
  cameraZoom.solar+= (cameraTargetZoom.solar-cameraZoom.solar)*cameraEase;
  if(trackingTargetId){
    const target=solarMapPoint(trackingTargetId);
    cameraTargetPan.x+=canvases.solar.clientWidth*.5-target.x;
    cameraTargetPan.y+=canvases.solar.clientHeight*.5-target.y;
  }
  cameraPan.x+=(cameraTargetPan.x-cameraPan.x)*cameraEase;
  cameraPan.y+=(cameraTargetPan.y-cameraPan.y)*cameraEase;
  for(const view of ['lunar','vessel'])cameraZoom[view]+=(cameraTargetZoom[view]-cameraZoom[view])*cameraEase;
  const cameraMoving=zoomDifference>1e-5||Math.abs(cameraTargetPan.x-cameraPan.x)>.05||Math.abs(cameraTargetPan.y-cameraPan.y)>.05;
  if(advanced||expired||cameraMoving)drawAll();
  requestAnimationFrame(animate);
}

$('scenario').addEventListener('change',event=>{createScenario(event.target.value);});
$('time-scale').addEventListener('change',event=>world.setTimeScale(Number(event.target.value)));
$('pause-button').addEventListener('click',()=>{paused=!paused;world.setPaused(paused);$('pause-button').textContent=paused?'▶ Продолжить':'Ⅱ Пауза';});
$('step-button').addEventListener('click',()=>{if(!paused){paused=true;world.setPaused(true);$('pause-button').textContent='▶ Продолжить';}world.step();updateTelemetry();drawAll();});
$('reset-button').addEventListener('click',()=>{paused=false;world.setPaused(false);$('pause-button').textContent='Ⅱ Пауза';createScenario($('scenario').value);});
$('retro-button').addEventListener('click',()=>applyPoweredBurn(-10));
$('pro-button').addEventListener('click',()=>applyPoweredBurn(10));
window.addEventListener('resize',drawAll);

createScenario('earth-orbit');
world.setTimeScale(Number($('time-scale').value));
updateManeuverPlanner();
requestAnimationFrame(animate);
