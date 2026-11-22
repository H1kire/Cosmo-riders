import { createSolarSystemWorld, SOLAR_SYSTEM_DATA } from '../src/physics/solar-system.js';
import { add, magnitude, normalize, scale, subtract, vector3 } from '../src/physics/vector3.js';
import { stateToOrbitalElements, orbitalPeriod } from '../src/physics/orbital-elements.js';

const $ = id => document.getElementById(id);
const canvases = {
  solar: $('solar-view'),
  lunar: $('lunar-view'),
  vessel: $('vessel-view')
};
const DAY = 86400;
let world;
let vessel;
let paused = false;
let lastFrame = 0;
let trail = [];
let frameAccumulator = 0;
// Независимый масштаб каждой проекции; лунная система стартует отдалённой,
// чтобы в кадр помещалась и сфера влияния Земли.
const cameraZoom = { solar: 1, lunar: 0.34, vessel: 1 };
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 64;
const ZOOM_FACTOR = 1.25;

const fmt = (value, digits=2) => {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:digits}).format(value);
};
const distanceLabel = metres => metres >= 1e9 ? fmt(metres/1e9,3)+' млн км' : metres >= 1e6 ? fmt(metres/1e6,2)+' тыс. км' : fmt(metres/1e3,1)+' км';
const speedLabel = value => fmt(value/1000,3)+' км/с';
const getBody = id => world.getBodyState(id);
const body = id => world.bodies.get(id);
const currentPrimary = () => body(vessel.primaryBodyId);
const currentPrimaryState = () => getBody(vessel.primaryBodyId);

function createScenario(name) {
  world = createSolarSystemWorld({fixedStepSeconds:1,maxSubSteps:10000});
  const earth = getBody('earth');
  const moon = getBody('moon');
  const earthMu = body('earth').mu;
  const moonMu = body('moon').mu;
  if (name === 'moon-approach') {
    const moonSoi = world.getSphereOfInfluence('moon');
    const offset = vector3(moonSoi*0.72,0,0);
    const relativeMoonVelocity = vector3(0,180,0);
    vessel = world.addVessel({
      id:'test-vessel',primaryBodyId:'earth',
      position:add(moon.position,offset),
      velocity:add(moon.velocity,relativeMoonVelocity)
    });
  } else if (name === 'moon-orbit') {
    const radius = 2_000_000;
    vessel = world.addVessel({
      id:'test-vessel',primaryBodyId:'moon',
      position:add(moon.position,vector3(radius,0,0)),
      velocity:add(moon.velocity,vector3(0,Math.sqrt(moonMu/radius),0))
    });
  } else {
    const radius = 7_000_000;
    vessel = world.addVessel({
      id:'test-vessel',primaryBodyId:'earth',
      position:add(earth.position,vector3(radius,0,0)),
      velocity:add(earth.velocity,vector3(0,Math.sqrt(earthMu/radius),0))
    });
  }
  trail = [];
  frameAccumulator = 0;
  updateTelemetry();
  drawAll();
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1,2);
  const width = Math.max(1,Math.round(rect.width*dpr));
  const height = Math.max(1,Math.round(rect.height*dpr));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,width:rect.width,height:rect.height};
}
function point(ctx,x,y,r,color,glow=false) {
  ctx.save();ctx.fillStyle=color;
  if(glow){ctx.shadowBlur=15;ctx.shadowColor=color;}
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();
}
function ring(ctx,x,y,r,color,dash=[5,5],alpha=.7) {
  ctx.save();ctx.strokeStyle=color;ctx.globalAlpha=alpha;ctx.lineWidth=1;ctx.setLineDash(dash);
  ctx.beginPath();ctx.arc(x,y,Math.max(1,r),0,Math.PI*2);ctx.stroke();ctx.restore();
}
function label(ctx,text,x,y,color='#9aabc2') {
  ctx.save();ctx.fillStyle=color;ctx.font='11px Segoe UI,Arial';ctx.fillText(text,x,y);ctx.restore();
}
function line(ctx,x1,y1,x2,y2,color='#253b57') {
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.restore();
}
function drawSolar() {
  const {ctx,width:w,height:h}=resizeCanvas(canvases.solar);
  ctx.clearRect(0,0,w,h);
  const cx=w*.5,cy=h*.52,scalePx=Math.min(w*.39,h*.39)*cameraZoom.solar;
  const earthState=getBody('earth'),sunState=getBody('sun');
  const ex=cx+(earthState.position.x-sunState.position.x)/SOLAR_SYSTEM_DATA.earth.elements.semiMajorAxisM*scalePx;
  const ey=cy-(earthState.position.y-sunState.position.y)/SOLAR_SYSTEM_DATA.earth.elements.semiMajorAxisM*scalePx;
  ctx.save();ctx.strokeStyle='#39516e';ctx.setLineDash([3,6]);ctx.beginPath();ctx.ellipse(cx,cy,scalePx,scalePx*.985,0,0,Math.PI*2);ctx.stroke();ctx.restore();
  const earthSoi=world.getSphereOfInfluence('earth');
  ring(ctx,ex,ey,earthSoi/SOLAR_SYSTEM_DATA.earth.elements.semiMajorAxisM*scalePx,'#6c9cff',[3,4],.95);
  point(ctx,cx,cy,8,'#ffc86b',true);label(ctx,'Солнце',cx+13,cy-12,'#ffda91');
  point(ctx,ex,ey,5,'#5e9cff',true);label(ctx,'Земля',ex+10,ey-10,'#a9caff');
  const shipState=world.getVesselState('test-vessel');
  const shipX=cx+(shipState.position.x-sunState.position.x)/SOLAR_SYSTEM_DATA.earth.elements.semiMajorAxisM*scalePx;
  const shipY=cy-(shipState.position.y-sunState.position.y)/SOLAR_SYSTEM_DATA.earth.elements.semiMajorAxisM*scalePx;
  point(ctx,shipX,shipY,3,'#ffffff',true);
  label(ctx,'1 AU',cx+scalePx*.55,cy+16);
  label(ctx,'Схема: расстояния Солнце—Земля в масштабе; корабль условно увеличен.',12,h-13,'#6e829c');
}
function drawLunar() {
  const {ctx,width:w,height:h}=resizeCanvas(canvases.lunar);
  ctx.clearRect(0,0,w,h);
  const cx=w*.5,cy=h*.51;
  const moonDistance=SOLAR_SYSTEM_DATA.moon.elements.semiMajorAxisM;
  const px=Math.min(w*.31,h*.34)/moonDistance*cameraZoom.lunar;
  const earth=getBody('earth'),moon=getBody('moon');
  const dx=(moon.position.x-earth.position.x)*px,dy=-(moon.position.y-earth.position.y)*px;
  const ex=cx,ey=cy,mx=cx+dx,my=cy+dy;
  const earthSoi=world.getSphereOfInfluence('earth'),moonSoi=world.getSphereOfInfluence('moon');
  ring(ctx,ex,ey,earthSoi*px,'#6c9cff',[5,5],.45);
  ctx.save();ctx.strokeStyle='#526780';ctx.setLineDash([3,5]);ctx.beginPath();ctx.ellipse(ex,ey,moonDistance*px,moonDistance*px*.97,0,0,Math.PI*2);ctx.stroke();ctx.restore();
  ring(ctx,mx,my,moonSoi*px,'#83e0b0',[3,4],.95);
  point(ctx,ex,ey,8,'#5e9cff',true);label(ctx,'Земля',ex+12,ey-13,'#a9caff');
  point(ctx,mx,my,4,'#b8c7d8',true);label(ctx,'Луна',mx+10,my-9,'#d9e4f0');
  const ship=world.getVesselState('test-vessel');
  const sx=cx+(ship.position.x-earth.position.x)*px,sy=cy-(ship.position.y-earth.position.y)*px;
  point(ctx,sx,sy,3.5,'#fff',true);
  label(ctx,'384 400 км',cx+moonDistance*px*.45,cy+18);
  label(ctx,'Показаны локальные SOI Земли и Луны; внешний контур Земли может выходить за кадр.',12,h-13,'#6e829c');
}
function drawVessel() {
  const {ctx,width:w,height:h}=resizeCanvas(canvases.vessel);
  ctx.clearRect(0,0,w,h);
  const primary=currentPrimary(),primaryState=currentPrimaryState();
  const ship=world.getVesselState('test-vessel');
  const relativePosition=subtract(ship.position,primaryState.position);
  const radius=magnitude(relativePosition);
  const soi=world.getSphereOfInfluence(primary.id);
  const scaleDistance=Math.max(radius*2.4,primary.meanRadiusM*100);
  const px=Math.min(w*.38,h*.38)/scaleDistance*cameraZoom.vessel;
  const cx=w*.5,cy=h*.52;
  if(soi)ring(ctx,cx,cy,soi*px,'#6c9cff',[5,5],.75);
  const orbitRadius=radius*px;
  ring(ctx,cx,cy,orbitRadius,'#536c8a',[2,5],.9);
  if(trail.length>1){
    ctx.save();ctx.strokeStyle='#d9f5ff';ctx.globalAlpha=.65;ctx.lineWidth=1.5;ctx.beginPath();
    trail.forEach((p,i)=>{const x=cx+p.x*px,y=cy-p.y*px;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.stroke();ctx.restore();
  }
  point(ctx,cx,cy,primary.id==='sun'?8:primary.id==='earth'?7:5,primary.id==='earth'?'#5e9cff':primary.id==='moon'?'#b8c7d8':'#ffc86b',true);
  point(ctx,cx+relativePosition.x*px,cy-relativePosition.y*px,4,'#fff',true);
  label(ctx,primary.name,cx+12,cy-12,'#c3d8f0');
  label(ctx,'Корабль',cx+relativePosition.x*px+9,cy-relativePosition.y*px-9,'#fff');
  label(ctx,'r = '+distanceLabel(radius),12,h-30);
  label(ctx,'SOI = '+(soi?distanceLabel(soi):'не определена'),12,h-13,'#8ba2c0');
  $('detail-scale').textContent='Окружность: '+primary.name+' · масштаб локальный';
}
function drawAll(){drawSolar();drawLunar();drawVessel();updateZoomLabels();}

function updateZoomLabels() {
  for (const view of Object.keys(cameraZoom)) {
    const output = $('zoom-value-' + view);
    if (output) output.textContent = Math.round(cameraZoom[view] * 100) + '%';
  }
}

function changeZoom(view, direction) {
  if (!(view in cameraZoom)) return;
  cameraZoom[view] = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM,
    cameraZoom[view] * (direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)));
  drawAll();
}

function resetZoom(view) {
  if (!(view in cameraZoom)) return;
  cameraZoom[view] = view === 'lunar' ? 0.34 : 1;
  drawAll();
}

function bindCameraControls(view) {
  const canvas = canvases[view];
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    changeZoom(view, event.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  document.querySelectorAll('[data-zoom-view="' + view + '"]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.zoomAction;
      if (action === 'in') changeZoom(view, 1);
      else if (action === 'out') changeZoom(view, -1);
      else if (action === 'reset') resetZoom(view);
    });
  });
}

for (const view of Object.keys(canvases)) bindCameraControls(view);

function updateTelemetry() {
  if(!vessel)return;
  const primary=currentPrimary(),state=currentPrimaryState();
  const relativePosition=subtract(vessel.position,state.position);
  const relativeVelocity=subtract(vessel.velocity,state.velocity);
  const r=magnitude(relativePosition),v=magnitude(relativeVelocity);
  const elements=stateToOrbitalElements(relativePosition,relativeVelocity,primary.mu);
  const period=elements.trajectoryType==='elliptic'?orbitalPeriod(elements.semiMajorAxis,primary.mu):null;
  $('primary-badge').textContent=primary.name;
  $('distance-value').textContent=distanceLabel(r);
  $('speed-value').textContent=speedLabel(v);
  $('period-value').textContent=period?fmt(period/DAY,3)+' суток':'не замкнута';
  $('eccentricity-value').textContent=fmt(elements.eccentricity,6);
  $('soi-value').textContent=world.getSphereOfInfluence(primary.id)?distanceLabel(world.getSphereOfInfluence(primary.id)):'—';
  $('switch-value').textContent=vessel.lastPrimarySwitch?body(vessel.lastPrimarySwitch.from).name+' → '+body(vessel.lastPrimarySwitch.to).name:'не было';
  $('clock-value').textContent='J2000.0 + '+fmt(world.simulationTimeSeconds/DAY,5)+' суток';
}
function applyImpulse(deltaV) {
  const primary=currentPrimary(),state=currentPrimaryState();
  const relativeVelocity=subtract(vessel.velocity,state.velocity);
  vessel.relativeVelocity=add(vessel.relativeVelocity,scale(normalize(relativeVelocity),deltaV));
  vessel.velocity=add(state.velocity,vessel.relativeVelocity);
  updateTelemetry();drawAll();
}
function animate(timestamp) {
  if(!lastFrame)lastFrame=timestamp;
  const delta=Math.min((timestamp-lastFrame)/1000,.1);
  lastFrame=timestamp;
  if(!paused){
    const previousPrimary=vessel.primaryBodyId;
    const steps=world.advance(delta);
    if(steps>0){
      if(vessel.primaryBodyId!==previousPrimary)trail=[];
      const s=world.getVesselState('test-vessel');
      trail.push({x:s.position.x-currentPrimaryState().position.x,y:s.position.y-currentPrimaryState().position.y});
      if(trail.length>1200)trail.shift();
      updateTelemetry();drawAll();
    }
  }
  requestAnimationFrame(animate);
}

$('scenario').addEventListener('change',e=>createScenario(e.target.value));
$('time-scale').addEventListener('change',e=>world.setTimeScale(Number(e.target.value)));
$('pause-button').addEventListener('click',()=>{
  paused=!paused;world.setPaused(paused);
  $('pause-button').textContent=paused?'Продолжить':'Пауза';
});
$('step-button').addEventListener('click',()=>{
  if(!paused){paused=true;world.setPaused(true);$('pause-button').textContent='Продолжить';}
  world.step();updateTelemetry();drawAll();
});
$('reset-button').addEventListener('click',()=>createScenario($('scenario').value));
$('retro-button').addEventListener('click',()=>applyImpulse(-10));
$('pro-button').addEventListener('click',()=>applyImpulse(10));
window.addEventListener('resize',drawAll);

createScenario('earth-orbit');
world.setTimeScale(Number($('time-scale').value));
requestAnimationFrame(animate);