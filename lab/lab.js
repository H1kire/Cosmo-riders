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
const cameraPan = { x: 0, y: 0 };
let highestWindowZ = 50;
const MIN_ZOOM = 0.08, MAX_ZOOM = 64, ZOOM_FACTOR = 1.25;
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
  world = createSolarSystemWorld({fixedStepSeconds:1,maxSubSteps:10000});
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
  const {ctx,width:w,height:h}=resizeCanvas(canvases.solar);ctx.clearRect(0,0,w,h);
  const sun=getBody('sun'),maxRadius=SOLAR_SYSTEM_DATA.neptune.elements.semiMajorAxisM;
  const maxPx=Math.min(w*.43,h*.42)*cameraZoom.solar,cx=w*.5+cameraPan.x,cy=h*.5+cameraPan.y;
  const displayRadius=distance=>Math.log1p(distance/AU)/Math.log1p(maxRadius/AU)*maxPx;
  ctx.save();ctx.strokeStyle='#22364e';ctx.lineWidth=1;ctx.setLineDash([2,6]);
  for(const id of PLANET_IDS){
    const data=SOLAR_SYSTEM_DATA[id],a=data.elements.semiMajorAxisM,e=data.elements.eccentricity,r=displayRadius(a);
    ctx.beginPath();ctx.ellipse(cx-r*e,cy,r,r*Math.sqrt(1-e*e),0,0,Math.PI*2);ctx.stroke();
  }
  ctx.restore();
  point(ctx,cx,cy,6,'#ffd27b',true);label(ctx,'СОЛНЦЕ',cx+10,cy-10,'#ffdc9b','9px Segoe UI,Arial');
  for(const id of PLANET_IDS){
    const state=getBody(id),data=SOLAR_SYSTEM_DATA[id],dx=state.position.x-sun.position.x,dy=state.position.y-sun.position.y;
    const actualRadius=Math.hypot(dx,dy),shownRadius=displayRadius(actualRadius),x=cx+dx/actualRadius*shownRadius,y=cy-dy/actualRadius*shownRadius;
    const radius=id==='jupiter'?4.2:id==='saturn'?3.8:id==='earth'?3.2:2.6;
    point(ctx,x,y,radius,PLANET_COLORS[id],id==='earth');
    label(ctx,data.name,x+6,y-6,PLANET_COLORS[id],'9px Segoe UI,Arial');
  }
  const ship=world.getVesselState('test-vessel'),sx=ship.position.x-sun.position.x,sy=ship.position.y-sun.position.y,shipRadius=Math.hypot(sx,sy),shipShown=displayRadius(shipRadius);
  point(ctx,cx+sx/shipRadius*shipShown,cy-sy/shipRadius*shipShown,2.7,'#fff',true);
  label(ctx,'30 AU',cx+maxPx*.83,cy+13,'#647f9d','9px Segoe UI,Arial');
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
function updateZoomLabels(){for(const view of Object.keys(cameraZoom)){const output=$('zoom-value-'+view);if(output)output.textContent=Math.round(cameraZoom[view]*100)+'%';}}
function drawAll(){drawSolar();drawLunar();drawVessel();updateZoomLabels();}
function changeZoom(view,direction){if(!(view in cameraZoom))return;cameraZoom[view]=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,cameraZoom[view]*(direction>0?ZOOM_FACTOR:1/ZOOM_FACTOR)));drawAll();}
function resetZoom(view){if(!(view in cameraZoom))return;cameraZoom[view]=view==='lunar'?.34:1;drawAll();}
function bindCameraControls(view){
  canvases[view].addEventListener('wheel',event=>{event.preventDefault();changeZoom(view,event.deltaY<0?1:-1);},{passive:false});
  document.querySelectorAll('[data-zoom-view="'+view+'"]').forEach(button=>button.addEventListener('click',()=>{const action=button.dataset.zoomAction;if(action==='in')changeZoom(view,1);else if(action==='out')changeZoom(view,-1);else if(action==='reset'){resetZoom(view);if(view==='solar')cameraPan.x=cameraPan.y=0;drawAll();}}));
}
for(const view of Object.keys(canvases))bindCameraControls(view);

// Full-screen solar-system camera: left mouse drag pans, wheel zooms around the view.
{
  const canvas=canvases.solar;
  let dragging=false,lastX=0,lastY=0;
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    dragging=true;lastX=event.clientX;lastY=event.clientY;
    canvas.classList.add('dragging');canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!dragging)return;
    cameraPan.x+=event.clientX-lastX;cameraPan.y+=event.clientY-lastY;
    lastX=event.clientX;lastY=event.clientY;drawSolar();
  });
  const stop=()=>{dragging=false;canvas.classList.remove('dragging');};
  canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
}
$('camera-home').addEventListener('click',()=>{cameraPan.x=0;cameraPan.y=0;cameraZoom.solar=1;drawAll();});

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
      updateTelemetry();advanced=true;
    }
  }
  if(advanced||expired)drawAll();
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
