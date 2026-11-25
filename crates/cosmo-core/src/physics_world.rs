use crate::physics::{orbital_elements_to_state,propagate_kepler,PropagatedState,Vec3};
use serde::{Deserialize,Serialize};
use std::collections::HashMap;
const G:f64=6.67430e-11;
fn v(a:[f64;3])->Result<Vec3,String>{let x=Vec3::new(a[0],a[1],a[2]);if x.finite(){Ok(x)}else{Err("Vector must be finite.".into())}}
fn arr(x:Vec3)->[f64;3]{[x.x,x.y,x.z]}
fn positive(x:f64,n:&str)->Result<(),String>{if x.is_finite()&&x>0.0{Ok(())}else{Err(format!("{n} must be finite and positive."))}}
#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Elements{pub semi_major_axis_m:f64,pub eccentricity:f64,#[serde(default)]pub inclination:f64,#[serde(default)]pub longitude_ascending_node:f64,#[serde(default)]pub argument_of_periapsis:f64,#[serde(default)]pub mean_anomaly:f64}
#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct BodyDefinition{
 pub id:String,pub name:String,pub mass_kg:f64,pub mean_radius_m:f64,
 #[serde(default)]pub position:[f64;3],#[serde(default)]pub velocity:[f64;3],
 #[serde(default)]pub parent_id:Option<String>,#[serde(default)]pub semi_major_axis_m:Option<f64>,
 #[serde(default)]pub orbital_elements:Option<Elements>,#[serde(default)]pub surface_seed:Option<i64>,
 #[serde(default)]pub surface:Option<serde_json::Value>,#[serde(default)]pub rotation_period_seconds:Option<f64>,
 #[serde(default)]pub axial_tilt_rad:Option<f64>,#[serde(default)]pub pole_right_ascension_rad:Option<f64>,
 #[serde(default)]pub pole_declination_rad:Option<f64>,#[serde(default="one")]pub rotation_direction:i8,
 #[serde(default)]pub prime_meridian_rad:f64,#[serde(default)]pub rotation_epoch_seconds:f64,
 #[serde(default)]pub tidal_lock:bool,#[serde(default)]pub equatorial_radius_m:Option<f64>,
 #[serde(default)]pub solar_day_seconds:Option<f64>,#[serde(default)]pub atmosphere_composition:Vec<String>,
 #[serde(default)]pub has_rings:bool,#[serde(default="frame")]pub orbital_reference_frame:String
}
fn one()->i8{1} fn frame()->String{"ecliptic".into()}
#[derive(Clone,Copy,Debug,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Options{#[serde(default="step")]pub fixed_step_seconds:f64,#[serde(default="max")]pub max_sub_steps:u32,#[serde(default="enter")]pub soi_enter_factor:f64,#[serde(default="exit")]pub soi_exit_factor:f64}
fn step()->f64{60.0}fn max()->u32{10000}fn enter()->f64{0.9}fn exit()->f64{1.1}
impl Default for Options{fn default()->Self{Self{fixed_step_seconds:60.0,max_sub_steps:10000,soi_enter_factor:0.9,soi_exit_factor:1.1}}}
#[derive(Clone,Copy,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct BodyState{pub position:[f64;3],pub velocity:[f64;3]}
impl BodyState{fn new(p:Vec3,v:Vec3)->Self{Self{position:arr(p),velocity:arr(v)}}fn p(self)->Vec3{Vec3::new(self.position[0],self.position[1],self.position[2])}fn vel(self)->Vec3{Vec3::new(self.velocity[0],self.velocity[1],self.velocity[2])}}
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct PrimarySwitch{pub from:String,pub to:String,pub time_seconds:f64}
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct VesselState{pub id:String,pub primary_body_id:String,pub position:[f64;3],pub velocity:[f64;3],pub relative_position:[f64;3],pub relative_velocity:[f64;3],pub mass_kg:f64,pub last_primary_switch:Option<PrimarySwitch>}
#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct VesselDefinition{pub id:String,pub primary_body_id:String,pub position:[f64;3],pub velocity:[f64;3],#[serde(default="mass")]pub mass_kg:f64}
fn mass()->f64{1000.0}
#[derive(Clone,Debug)]
struct Vessel{id:String,primary:String,p:Vec3,vel:Vec3,r:Vec3,v:Vec3,mass:f64,last:Option<PrimarySwitch>}
impl Vessel{fn snapshot(&self)->VesselState{VesselState{id:self.id.clone(),primary_body_id:self.primary.clone(),position:arr(self.p),velocity:arr(self.vel),relative_position:arr(self.r),relative_velocity:arr(self.v),mass_kg:self.mass,last_primary_switch:self.last.clone()}}}
fn parent_equator(s:PropagatedState,b:&BodyDefinition,p:&BodyDefinition)->PropagatedState{
 if b.orbital_reference_frame!="parent-equator"{return s}
 let(Some(ra),Some(dec))=(p.pole_right_ascension_rad,p.pole_declination_rad)else{return s};
 let e=23.4392911_f64.to_radians();let pole=Vec3::new(dec.cos()*ra.cos(),e.cos()*dec.cos()*ra.sin()+e.sin()*dec.sin(),-e.sin()*dec.cos()*ra.sin()+e.cos()*dec.sin());
 let x=Vec3::new(1.0-pole.x*pole.x,-pole.y*pole.x,-pole.z*pole.x).normalized().unwrap_or(Vec3::new(1.0,0.0,0.0));let y=pole.cross(x).normalized().unwrap_or(Vec3::new(0.0,1.0,0.0));
 let f=|q:Vec3|x.scale(q.x).add(y.scale(q.y)).add(pole.scale(q.z));PropagatedState{position:f(s.position),velocity:f(s.velocity),iterations:s.iterations}
}
pub struct PhysicsWorld{
 options:Options,bodies:Vec<BodyDefinition>,indices:HashMap<String,usize>,initial:Vec<Option<PropagatedState>>,states:Vec<BodyState>,
 vessels:Vec<Vessel>,vessel_indices:HashMap<String,usize>,pub simulation_time_seconds:f64,pub accumulator_seconds:f64,pub time_scale:f64,pub paused:bool,initialized:bool
}
impl PhysicsWorld{
 pub fn new(o:Options)->Result<Self,String>{positive(o.fixed_step_seconds,"fixedStepSeconds")?;if o.max_sub_steps==0{return Err("maxSubSteps must be positive.".into())}if !(o.soi_enter_factor>0.0&&o.soi_enter_factor<1.0){return Err("soiEnterFactor must be between zero and one.".into())}if !(o.soi_exit_factor>1.0){return Err("soiExitFactor must exceed one.".into())}Ok(Self{options:o,bodies:vec![],indices:HashMap::new(),initial:vec![],states:vec![],vessels:vec![],vessel_indices:HashMap::new(),simulation_time_seconds:0.0,accumulator_seconds:0.0,time_scale:1.0,paused:false,initialized:false})}
 pub fn add_body(&mut self,b:BodyDefinition)->Result<(),String>{
  if self.initialized{return Err("Cannot add bodies after ephemeris initialization.".into())}if b.id.trim().is_empty()||b.name.trim().is_empty(){return Err("Body id and name must be non-empty.".into())}positive(b.mass_kg,"massKg")?;positive(b.mean_radius_m,"meanRadiusM")?;v(b.position)?;v(b.velocity)?;
  if b.rotation_direction!=1&&b.rotation_direction != -1{return Err("rotationDirection must be 1 or -1.".into())}if b.orbital_reference_frame!="ecliptic"&&b.orbital_reference_frame!="parent-equator"{return Err("Unsupported orbital reference frame.".into())}
  if let Some(x)=b.rotation_period_seconds{positive(x,"rotationPeriodSeconds")?}if let Some(x)=b.equatorial_radius_m{positive(x,"equatorialRadiusM")?}if let Some(x)=b.solar_day_seconds{positive(x,"solarDaySeconds")?}
  if !b.prime_meridian_rad.is_finite()||!b.rotation_epoch_seconds.is_finite(){return Err("Rotation phase and epoch must be finite.".into())}
  if let Some(e)=&b.orbital_elements{positive(e.semi_major_axis_m,"semiMajorAxisM")?;if !e.eccentricity.is_finite()||!(0.0..1.0).contains(&e.eccentricity){return Err("Elliptic eccentricity must be in [0, 1).".into())}if b.parent_id.is_none(){return Err("An orbiting body must have parentId.".into())}}
  if self.indices.contains_key(&b.id){return Err(format!("Duplicate body id: {}",b.id))}match &b.parent_id{Some(p)if !self.indices.contains_key(p)=>return Err(format!("Parent body not found: {p}")),None if !self.bodies.is_empty()=>return Err("Only one root body is supported.".into()),_=>{}}
  let i=self.bodies.len();self.indices.insert(b.id.clone(),i);self.bodies.push(b);self.initial.push(None);self.states.push(BodyState{position:[0.0;3],velocity:[0.0;3]});Ok(())
 }
 pub fn body_count(&self)->usize{self.bodies.len()}pub fn body_ids(&self)->Vec<String>{self.bodies.iter().map(|b|b.id.clone()).collect()}pub fn body(&self,id:&str)->Option<&BodyDefinition>{self.indices.get(id).map(|i|&self.bodies[*i])}
 pub fn initialize_ephemerides(&mut self)->Result<(),String>{if self.initialized{return Ok(())}for i in 0..self.bodies.len(){let b=&self.bodies[i];if let Some(pid)=&b.parent_id{let pi=*self.indices.get(pid).ok_or_else(||format!("Parent body not found: {pid}"))?;let p=&self.bodies[pi];let ps=self.states[pi];let rel=if let Some(e)=&b.orbital_elements{let(r,v)=orbital_elements_to_state(e.semi_major_axis_m,e.eccentricity,e.inclination,e.longitude_ascending_node,e.argument_of_periapsis,e.mean_anomaly,G*(b.mass_kg+p.mass_kg))?;parent_equator(PropagatedState{position:r,velocity:v,iterations:0},b,p)}else{PropagatedState{position:v(b.position)?.sub(v(p.position)?),velocity:v(b.velocity)?.sub(v(p.velocity)?),iterations:0}};self.initial[i]=Some(rel);self.states[i]=BodyState::new(ps.p().add(rel.position),ps.vel().add(rel.velocity));}else{self.states[i]=BodyState{position:b.position,velocity:b.velocity}}}self.initialized=true;Ok(())}
 fn ready(&mut self)->Result<(),String>{self.initialize_ephemerides()}
 pub fn sphere_of_influence(&self,id:&str)->Option<f64>{let i=*self.indices.get(id)?;let b=&self.bodies[i];let pi=*self.indices.get(b.parent_id.as_ref()?)?;let p=&self.bodies[pi];let a=b.semi_major_axis_m.or_else(||b.orbital_elements.as_ref().map(|e|e.semi_major_axis_m))?;if b.mass_kg>=p.mass_kg{return None}Some(a*(b.mass_kg/p.mass_kg).powf(0.4))}
 pub fn body_state(&mut self,id:&str)->Result<BodyState,String>{self.ready()?;let i=*self.indices.get(id).ok_or_else(||format!("Unknown body: {id}"))?;Ok(self.states[i])}
 pub fn add_vessel(&mut self,d:VesselDefinition)->Result<(),String>{self.ready()?;if d.id.trim().is_empty(){return Err("Vessel id must be non-empty.".into())}if self.vessel_indices.contains_key(&d.id){return Err(format!("Duplicate vessel id: {}",d.id))}positive(d.mass_kg,"massKg")?;let pi=*self.indices.get(&d.primary_body_id).ok_or_else(||format!("Primary body not found: {}",d.primary_body_id))?;let p=v(d.position)?;let vel=v(d.velocity)?;let ps=self.states[pi];let vessel=Vessel{id:d.id.clone(),primary:d.primary_body_id,p,vel,r:p.sub(ps.p()),v:vel.sub(ps.vel()),mass:d.mass_kg,last:None};let i=self.vessels.len();self.vessel_indices.insert(d.id,i);self.vessels.push(vessel);Ok(())}
 pub fn set_time_scale(&mut self,x:f64)->Result<(),String>{if !x.is_finite()||x<0.0{return Err("timeScale must be finite and non-negative.".into())}self.time_scale=x;Ok(())}pub fn set_paused(&mut self,x:bool){self.paused=x}
 pub fn update_ephemerides(&mut self)->Result<(),String>{self.ready()?;for i in 0..self.bodies.len(){let Some(pid)=self.bodies[i].parent_id.as_ref()else{continue};let pi=self.indices[pid];let init=self.initial[i].ok_or("Missing initial relative state.")?;let rel=propagate_kepler(init.position,init.velocity,G*(self.bodies[i].mass_kg+self.bodies[pi].mass_kg),self.simulation_time_seconds,1e-10,100)?;let ps=self.states[pi];self.states[i]=BodyState::new(ps.p().add(rel.position),ps.vel().add(rel.velocity));}Ok(())}
 pub fn body_states_at(&mut self,t:f64)->Result<Vec<f64>,String>{self.ready()?;if !t.is_finite(){return Err("timeSeconds must be finite.".into())}let mut out=Vec::with_capacity(self.bodies.len()*6);let mut computed:Vec<BodyState>=Vec::with_capacity(self.bodies.len());for i in 0..self.bodies.len(){let b=&self.bodies[i];let s=if let Some(pid)=&b.parent_id{let pi=self.indices[pid];let init=self.initial[i].ok_or("Missing initial relative state.")?;let rel=propagate_kepler(init.position,init.velocity,G*(b.mass_kg+self.bodies[pi].mass_kg),t,1e-10,100)?;BodyState::new(computed[pi].p().add(rel.position),computed[pi].vel().add(rel.velocity))}else{BodyState{position:b.position,velocity:b.velocity}};out.extend_from_slice(&s.position);out.extend_from_slice(&s.velocity);computed.push(s)}Ok(out)}
 fn choose_primary(&self,vessel:&Vessel)->Result<String,String>{let ci=*self.indices.get(&vessel.primary).ok_or("Missing current primary.")?;let current=&self.bodies[ci];if let Some(pid)=&current.parent_id{if let Some(soi)=self.sphere_of_influence(&current.id){if vessel.p.sub(self.states[ci].p()).norm()>soi*self.options.soi_exit_factor{return Ok(pid.clone())}}}let mut best:Option<(String,f64)>=None;for(i,b)in self.bodies.iter().enumerate(){if b.parent_id.as_deref()!=Some(current.id.as_str()){continue}if let Some(soi)=self.sphere_of_influence(&b.id){let d=vessel.p.sub(self.states[i].p()).norm();if d<soi*self.options.soi_enter_factor&&best.as_ref().map(|x|soi<x.1).unwrap_or(true){best=Some((b.id.clone(),soi))}}}Ok(best.map(|x|x.0).unwrap_or_else(||current.id.clone()))}
 fn switch_primary(&mut self,i:usize,next:String){if self.vessels[i].primary==next{return}let ni=self.indices[&next];let state=self.states[ni];let old=self.vessels[i].primary.clone();let x=&mut self.vessels[i];x.r=x.p.sub(state.p());x.v=x.vel.sub(state.vel());x.last=Some(PrimarySwitch{from:old,to:next.clone(),time_seconds:self.simulation_time_seconds});x.primary=next}
 pub fn step(&mut self)->Result<(),String>{self.ready()?;self.simulation_time_seconds+=self.options.fixed_step_seconds;self.update_ephemerides()?;for i in 0..self.vessels.len(){let pi=self.indices[&self.vessels[i].primary];let ps=self.states[pi];let mu=G*self.bodies[pi].mass_kg;let next=propagate_kepler(self.vessels[i].r,self.vessels[i].v,mu,self.options.fixed_step_seconds,1e-10,100)?;self.vessels[i].r=next.position;self.vessels[i].v=next.velocity;self.vessels[i].p=ps.p().add(next.position);self.vessels[i].vel=ps.vel().add(next.velocity);let primary=self.choose_primary(&self.vessels[i])?;self.switch_primary(i,primary)}Ok(())}
 pub fn advance(&mut self,dt:f64)->Result<u32,String>{if !dt.is_finite()||dt<0.0{return Err("realDeltaSeconds must be finite and non-negative.".into())}if self.paused||self.time_scale==0.0||dt==0.0{return Ok(0)}let total=self.accumulator_seconds+dt*self.time_scale;if !total.is_finite(){return Err("Physics accumulator overflow.".into())}let count=(total/self.options.fixed_step_seconds).floor();if count>self.options.max_sub_steps as f64{return Err("Physics backlog exceeds maxSubSteps.".into())}let n=count as u32;let old_time=self.simulation_time_seconds;let old_states=self.states.clone();let old_vessels=self.vessels.clone();for _ in 0..n{if let Err(e)=self.step(){self.simulation_time_seconds=old_time;self.states=old_states;self.vessels=old_vessels;return Err(e)}}self.accumulator_seconds=(total-n as f64*self.options.fixed_step_seconds).max(0.0);Ok(n)}
 pub fn vessel_state(&self,id:&str)->Result<VesselState,String>{let i=*self.vessel_indices.get(id).ok_or_else(||format!("Unknown vessel: {id}"))?;Ok(self.vessels[i].snapshot())}
 pub fn vessel_states(&self)->Vec<VesselState>{self.vessels.iter().map(Vessel::snapshot).collect()}
 pub fn vessel_state_at(&self,id:&str,t:f64,body_states:&[f64])->Result<VesselState,String>{if !t.is_finite(){return Err("timeSeconds must be finite.".into())}let i=*self.vessel_indices.get(id).ok_or_else(||format!("Unknown vessel: {id}"))?;let vessel=&self.vessels[i];let pi=self.indices[&vessel.primary];if body_states.len()!=self.bodies.len()*6{return Err("Invalid body snapshot length.".into())}let k=pi*6;let p=Vec3::new(body_states[k],body_states[k+1],body_states[k+2]);let vel=Vec3::new(body_states[k+3],body_states[k+4],body_states[k+5]);let rel=propagate_kepler(vessel.r,vessel.v,G*self.bodies[pi].mass_kg,t-self.simulation_time_seconds,1e-10,100)?;Ok(VesselState{position:arr(p.add(rel.position)),velocity:arr(vel.add(rel.velocity)),relative_position:arr(rel.position),relative_velocity:arr(rel.velocity),..vessel.snapshot()})}
 pub fn apply_impulse(&mut self,id:&str,direction:[f64;3],dv:f64)->Result<(),String>{if !dv.is_finite()||dv<0.0{return Err("deltaVMS must be non-negative.".into())}let dir=v(direction)?.normalized()?;let i=*self.vessel_indices.get(id).ok_or_else(||format!("Unknown vessel: {id}"))?;let pi=self.indices[&self.vessels[i].primary];self.vessels[i].v=self.vessels[i].v.add(dir.scale(dv));self.vessels[i].vel=self.states[pi].vel().add(self.vessels[i].v);Ok(())}
 pub fn rotation_angle_at(&self,id:&str,t:f64)->Result<Option<f64>,String>{let b=self.body(id).ok_or_else(||format!("Unknown body: {id}"))?;if !t.is_finite(){return Err("time must be finite.".into())}Ok(b.rotation_period_seconds.filter(|_|!b.tidal_lock).map(|p|b.prime_meridian_rad+b.rotation_direction as f64*std::f64::consts::TAU*((t-b.rotation_epoch_seconds)/p)))}
}
#[cfg(test)]mod tests{use super::*;fn body()->BodyDefinition{serde_json::from_str(r#"{"id":"earth","name":"Earth","massKg":5.9722e24,"meanRadiusM":6371000}"#).unwrap()}#[test]fn clock_pause_scale(){let mut w=PhysicsWorld::new(Options{fixed_step_seconds:1.0,max_sub_steps:100,soi_enter_factor:0.9,soi_exit_factor:1.1}).unwrap();w.add_body(body()).unwrap();w.set_time_scale(2.0).unwrap();assert_eq!(w.advance(1.5).unwrap(),3);assert_eq!(w.simulation_time_seconds,3.0);w.set_paused(true);assert_eq!(w.advance(10.0).unwrap(),0)}#[test]fn rejects_duplicate_and_missing_parent(){let mut w=PhysicsWorld::new(Options::default()).unwrap();w.add_body(body()).unwrap();assert!(w.add_body(body()).is_err());let moon:BodyDefinition=serde_json::from_str(r#"{"id":"moon","name":"Moon","massKg":7e22,"meanRadiusM":1e6,"parentId":"missing"}"#).unwrap();assert!(w.add_body(moon).is_err())}#[test]fn fractional_snapshots_do_not_mutate_world(){let mut w=PhysicsWorld::new(Options::default()).unwrap();w.add_body(body()).unwrap();let a=w.body_states_at(30.0).unwrap();let b=w.body_states_at(30.0).unwrap();assert_eq!(a,b);assert_eq!(w.simulation_time_seconds,0.0)}}
