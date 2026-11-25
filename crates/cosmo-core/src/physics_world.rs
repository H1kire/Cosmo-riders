use crate::physics::{orbital_elements_to_state,propagate_kepler,PropagatedState,Vec3};
use crate::nbody::{NBody,NBodySystem};
use crate::propulsion::{integrate_engines,Engine};
use serde::{Deserialize,Serialize};
use std::collections::HashMap;
const G:f64=6.67430e-11;const STANDARD_G:f64=9.80665;
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
pub struct VesselState{pub id:String,pub primary_body_id:String,pub position:[f64;3],pub velocity:[f64;3],pub relative_position:[f64;3],pub relative_velocity:[f64;3],pub mass_kg:f64,pub last_primary_switch:Option<PrimarySwitch>,pub primary_body_history:Vec<PrimarySwitch>}
#[derive(Clone,Debug,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct VesselDefinition{pub id:String,pub primary_body_id:String,pub position:[f64;3],pub velocity:[f64;3],#[serde(default="mass")]pub mass_kg:f64,#[serde(default)]pub engines:Vec<Engine>}
fn mass()->f64{1000.0}
fn gravity_from_bodies(bodies:&[(f64,f64,Vec3)],position:Vec3)->Result<Vec3,String>{
 let mut acceleration=Vec3::new(0.0,0.0,0.0);
 for(mass,radius,body_position)in bodies{
  let delta=body_position.sub(position);let distance=delta.norm();
  if !distance.is_finite()||distance<=*radius{return Err("Vessel collision with a celestial body's physical radius.".into())}
  acceleration=acceleration.add(delta.scale(G*mass/(distance*distance*distance)));
 }
 if acceleration.finite(){Ok(acceleration)}else{Err("Gravitational acceleration became non-finite.".into())}
}
#[derive(Clone,Debug)]
struct Vessel{id:String,primary:String,p:Vec3,vel:Vec3,r:Vec3,v:Vec3,mass:f64,engines:Vec<Engine>,last_thrust_n:f64,last_mass_flow_kg_s:f64,last_acceleration_m_s2:f64,last:Option<PrimarySwitch>,history:Vec<PrimarySwitch>}
impl Vessel{fn snapshot(&self)->VesselState{VesselState{id:self.id.clone(),primary_body_id:self.primary.clone(),position:arr(self.p),velocity:arr(self.vel),relative_position:arr(self.r),relative_velocity:arr(self.v),mass_kg:self.mass,last_primary_switch:self.last.clone(),primary_body_history:self.history.clone()}}}
fn parent_equator(s:PropagatedState,b:&BodyDefinition,p:&BodyDefinition)->PropagatedState{
 if b.orbital_reference_frame!="parent-equator"{return s}
 let(Some(ra),Some(dec))=(p.pole_right_ascension_rad,p.pole_declination_rad)else{return s};
 let e=23.4392911_f64.to_radians();let pole=Vec3::new(dec.cos()*ra.cos(),e.cos()*dec.cos()*ra.sin()+e.sin()*dec.sin(),-e.sin()*dec.cos()*ra.sin()+e.cos()*dec.sin());
 let x=Vec3::new(1.0-pole.x*pole.x,-pole.y*pole.x,-pole.z*pole.x).normalized().unwrap_or(Vec3::new(1.0,0.0,0.0));let y=pole.cross(x).normalized().unwrap_or(Vec3::new(0.0,1.0,0.0));
 let f=|q:Vec3|x.scale(q.x).add(y.scale(q.y)).add(pole.scale(q.z));PropagatedState{position:f(s.position),velocity:f(s.velocity),iterations:s.iterations}
}
#[derive(Clone,Copy,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct BurnResult{pub initial_mass_kg:f64,pub final_mass_kg:f64,pub propellant_used_kg:f64,pub burn_duration_seconds:f64,pub mass_flow_kg_s:f64,pub delta_v_m_s:f64,pub thrust_n:f64,pub thrust_to_weight_ratio:f64}
pub struct PhysicsWorld{
 options:Options,bodies:Vec<BodyDefinition>,indices:HashMap<String,usize>,initial:Vec<Option<PropagatedState>>,states:Vec<BodyState>,
 vessels:Vec<Vessel>,vessel_indices:HashMap<String,usize>,nbody:Option<NBodySystem>,pub simulation_time_seconds:f64,pub accumulator_seconds:f64,pub time_scale:f64,pub paused:bool,initialized:bool
}
impl PhysicsWorld{
 pub fn new(o:Options)->Result<Self,String>{positive(o.fixed_step_seconds,"fixedStepSeconds")?;if o.max_sub_steps==0{return Err("maxSubSteps must be positive.".into())}if !(o.soi_enter_factor>0.0&&o.soi_enter_factor<1.0){return Err("soiEnterFactor must be between zero and one.".into())}if !(o.soi_exit_factor>1.0){return Err("soiExitFactor must exceed one.".into())}Ok(Self{options:o,bodies:vec![],indices:HashMap::new(),initial:vec![],states:vec![],vessels:vec![],vessel_indices:HashMap::new(),nbody:None,simulation_time_seconds:0.0,accumulator_seconds:0.0,time_scale:1.0,paused:false,initialized:false})}
 pub fn add_body(&mut self,mut b:BodyDefinition)->Result<(),String>{
  if self.initialized{return Err("Cannot add bodies after ephemeris initialization.".into())}if b.id.trim().is_empty()||b.name.trim().is_empty(){return Err("Body id and name must be non-empty.".into())}positive(b.mass_kg,"massKg")?;positive(b.mean_radius_m,"meanRadiusM")?;v(b.position)?;v(b.velocity)?;
  if b.rotation_direction!=1&&b.rotation_direction != -1{return Err("rotationDirection must be 1 or -1.".into())}if b.orbital_reference_frame!="ecliptic"&&b.orbital_reference_frame!="parent-equator"{return Err("Unsupported orbital reference frame.".into())}
  if let Some(x)=b.rotation_period_seconds{positive(x,"rotationPeriodSeconds")?}if let Some(x)=b.equatorial_radius_m{positive(x,"equatorialRadiusM")?}if let Some(x)=b.semi_major_axis_m{positive(x,"semiMajorAxisM")?}if let Some(x)=b.solar_day_seconds{positive(x,"solarDaySeconds")?}
  if !b.prime_meridian_rad.is_finite()||!b.rotation_epoch_seconds.is_finite(){return Err("Rotation phase and epoch must be finite.".into())}
  if let Some(e)=&b.orbital_elements{positive(e.semi_major_axis_m,"semiMajorAxisM")?;if !e.eccentricity.is_finite()||!(0.0..1.0).contains(&e.eccentricity){return Err("Elliptic eccentricity must be in [0, 1).".into())}if b.parent_id.is_none(){return Err("An orbiting body must have parentId.".into())}}
  if self.indices.contains_key(&b.id){return Err(format!("Duplicate body id: {}",b.id))}match &b.parent_id{Some(p)if !self.indices.contains_key(p)=>return Err(format!("Parent body not found: {p}")),None if !self.bodies.is_empty()=>return Err("Only one root body is supported.".into()),_=>{}}
  if b.semi_major_axis_m.is_none(){b.semi_major_axis_m=b.orbital_elements.as_ref().map(|e|e.semi_major_axis_m);}
  if b.tidal_lock&&b.rotation_period_seconds.is_none(){if let(Some(a),Some(parent_id))=(b.semi_major_axis_m,b.parent_id.as_ref()){let parent=&self.bodies[self.indices[parent_id]];b.rotation_period_seconds=Some(std::f64::consts::TAU*(a.powi(3)/(G*(b.mass_kg+parent.mass_kg))).sqrt());}}
  let i=self.bodies.len();self.indices.insert(b.id.clone(),i);self.bodies.push(b);self.initial.push(None);self.states.push(BodyState{position:[0.0;3],velocity:[0.0;3]});Ok(())
 }
 pub fn body_count(&self)->usize{self.bodies.len()}pub fn body_ids(&self)->Vec<String>{self.bodies.iter().map(|b|b.id.clone()).collect()}pub fn body(&self,id:&str)->Option<&BodyDefinition>{self.indices.get(id).map(|i|&self.bodies[*i])}
 pub fn gravitational_parameter(&self,id:&str)->Result<f64,String>{let b=self.body(id).ok_or_else(||format!("Unknown body: {id}"))?;Ok(G*b.mass_kg)}
 pub fn circular_orbit_speed(&self,id:&str,radius:f64)->Result<f64,String>{positive(radius,"orbitRadiusM")?;crate::maneuvers::circular_orbit_speed(self.gravitational_parameter(id)?,radius)}

 pub fn orbit_path(&self,id:&str,segments:u32)->Result<Vec<f64>,String>{
  if !(16..=4096).contains(&segments){return Err("Orbit path segments must be in [16, 4096].".into())}
  let i=*self.indices.get(id).ok_or_else(||format!("Unknown body: {id}"))?;
  let body=&self.bodies[i];
  let parent_id=body.parent_id.as_ref().ok_or("A root body has no parent-relative orbit.")?;
  let parent=&self.bodies[*self.indices.get(parent_id).ok_or("Orbit parent not found.")?];
  let e=body.orbital_elements.as_ref().ok_or("Body has no classical orbital elements.")?;
  let mu=G*(body.mass_kg+parent.mass_kg);
  let mut out=Vec::with_capacity((segments as usize+1)*3);
  for n in 0..=segments{
   let mean=e.mean_anomaly+std::f64::consts::TAU*n as f64/segments as f64;
   let(r,v)=orbital_elements_to_state(e.semi_major_axis_m,e.eccentricity,e.inclination,e.longitude_ascending_node,e.argument_of_periapsis,mean,mu)?;
   let state=parent_equator(PropagatedState{position:r,velocity:v,iterations:0},body,parent);
   out.extend_from_slice(&[state.position.x,state.position.y,state.position.z]);
  }
  Ok(out)
 }

 pub fn initialize_ephemerides(&mut self)->Result<(),String>{if self.initialized{return Ok(())}for i in 0..self.bodies.len(){let b=&self.bodies[i];if let Some(pid)=&b.parent_id{let pi=*self.indices.get(pid).ok_or_else(||format!("Parent body not found: {pid}"))?;let p=&self.bodies[pi];let ps=self.states[pi];let rel=if let Some(e)=&b.orbital_elements{let(r,v)=orbital_elements_to_state(e.semi_major_axis_m,e.eccentricity,e.inclination,e.longitude_ascending_node,e.argument_of_periapsis,e.mean_anomaly,G*(b.mass_kg+p.mass_kg))?;parent_equator(PropagatedState{position:r,velocity:v,iterations:0},b,p)}else{PropagatedState{position:v(b.position)?.sub(v(p.position)?),velocity:v(b.velocity)?.sub(v(p.velocity)?),iterations:0}};self.initial[i]=Some(rel);self.states[i]=BodyState::new(ps.p().add(rel.position),ps.vel().add(rel.velocity));}else{self.states[i]=BodyState{position:b.position,velocity:b.velocity}}}self.initialized=true;Ok(())}
 pub fn enable_n_body(&mut self)->Result<(),String>{
  self.ready()?;if self.nbody.is_some(){return Ok(())}
  let mut bodies:Vec<NBody>=self.bodies.iter().zip(self.states.iter()).map(|(body,state)|NBody{
   id:body.id.clone(),mass_kg:body.mass_kg,collision_radius_m:body.mean_radius_m,
   position:state.p(),velocity:state.vel()
  }).collect();
  let total_mass:f64=bodies.iter().map(|b|b.mass_kg).sum();
  if !total_mass.is_finite()||total_mass<=0.0{return Err("Invalid total N-body mass.".into())}
  let center=bodies.iter().fold(Vec3::new(0.0,0.0,0.0),|sum,b|sum.add(b.position.scale(b.mass_kg/total_mass)));
  let drift=bodies.iter().fold(Vec3::new(0.0,0.0,0.0),|sum,b|sum.add(b.velocity.scale(b.mass_kg/total_mass)));
  for body in &mut bodies{body.position=body.position.sub(center);body.velocity=body.velocity.sub(drift);}
  for vessel in &mut self.vessels{vessel.p=vessel.p.sub(center);vessel.vel=vessel.vel.sub(drift);}
  self.nbody=Some(NBodySystem::new(bodies)?);self.sync_n_body_states()?;
  for vessel in &mut self.vessels{let pi=self.indices[&vessel.primary];vessel.r=vessel.p.sub(self.states[pi].p());vessel.v=vessel.vel.sub(self.states[pi].vel());}
  Ok(())
 }
 pub fn n_body_enabled(&self)->bool{self.nbody.is_some()}
 fn sync_n_body_states(&mut self)->Result<(),String>{
  if let Some(system)=&self.nbody{
   if system.bodies().len()!=self.bodies.len(){return Err("N-body/catalog size mismatch.".into())}
   for(i,body)in system.bodies().iter().enumerate(){if body.id!=self.bodies[i].id{return Err("N-body/catalog order mismatch.".into())}self.states[i]=BodyState::new(body.position,body.velocity);}
  }Ok(())
 }
 fn step_n_body(&mut self)->Result<(),String>{
  let dt=self.options.fixed_step_seconds;let start=self.nbody.as_ref().ok_or("N-body mode is not enabled.")?.clone();
  let end=start.advanced(dt,dt.abs())?;self.nbody=Some(end);self.sync_n_body_states()?;self.simulation_time_seconds+=dt;
  let gravity_bodies:Vec<(f64,f64,Vec3)>=self.bodies.iter().zip(self.states.iter()).map(|(b,s)|(b.mass_kg,b.mean_radius_m,s.p())).collect();
  for i in 0..self.vessels.len(){
   if self.vessels[i].engines.is_empty(){
    let(p,vv)=NBodySystem::integrate_test_particle(&start,self.nbody.as_ref().unwrap(),self.vessels[i].p,self.vessels[i].vel,dt)?;
    self.vessels[i].p=p;self.vessels[i].vel=vv;
   }else{
    let vessel=&mut self.vessels[i];
    let diagnostics=integrate_engines(&mut vessel.p,&mut vessel.vel,&mut vessel.mass,&mut vessel.engines,dt,|position|gravity_from_bodies(&gravity_bodies,position))?;
    vessel.last_thrust_n=diagnostics.thrust_n;vessel.last_mass_flow_kg_s=diagnostics.mass_flow_kg_s;vessel.last_acceleration_m_s2=diagnostics.acceleration_m_s2;
   }
   let pi=self.indices[&self.vessels[i].primary];let p=self.vessels[i].p;let vv=self.vessels[i].vel;
   self.vessels[i].r=p.sub(self.states[pi].p());self.vessels[i].v=vv.sub(self.states[pi].vel());
   let next=self.choose_primary(&self.vessels[i])?;self.switch_primary(i,next);
  }
  Ok(())
 }
 fn ready(&mut self)->Result<(),String>{self.initialize_ephemerides()}
 pub fn sphere_of_influence(&self,id:&str)->Option<f64>{let i=*self.indices.get(id)?;let b=&self.bodies[i];let pi=*self.indices.get(b.parent_id.as_ref()?)?;let p=&self.bodies[pi];let a=b.semi_major_axis_m.or_else(||b.orbital_elements.as_ref().map(|e|e.semi_major_axis_m))?;if b.mass_kg>=p.mass_kg{return None}Some(a*(b.mass_kg/p.mass_kg).powf(0.4))}
 pub fn body_state(&mut self,id:&str)->Result<BodyState,String>{self.ready()?;let i=*self.indices.get(id).ok_or_else(||format!("Unknown body: {id}"))?;Ok(self.states[i])}
 pub fn add_vessel(&mut self,d:VesselDefinition)->Result<(),String>{self.ready()?;if d.id.trim().is_empty(){return Err("Vessel id must be non-empty.".into())}if self.vessel_indices.contains_key(&d.id){return Err(format!("Duplicate vessel id: {}",d.id))}positive(d.mass_kg,"massKg")?;let pi=*self.indices.get(&d.primary_body_id).ok_or_else(||format!("Primary body not found: {}",d.primary_body_id))?;let p=v(d.position)?;let vel=v(d.velocity)?;let ps=self.states[pi];let mut engines=d.engines;let mut mass=d.mass_kg;for engine in &mut engines{engine.validate()?;mass+=engine.propellant_kg;}let vessel=Vessel{id:d.id.clone(),primary:d.primary_body_id,p,vel,r:p.sub(ps.p()),v:vel.sub(ps.vel()),mass,engines,last_thrust_n:0.0,last_mass_flow_kg_s:0.0,last_acceleration_m_s2:0.0,last:None,history:Vec::new()};let i=self.vessels.len();self.vessel_indices.insert(d.id,i);self.vessels.push(vessel);Ok(())}
 pub fn set_time_scale(&mut self,x:f64)->Result<(),String>{if !x.is_finite()||x<0.0{return Err("timeScale must be finite and non-negative.".into())}self.time_scale=x;Ok(())}pub fn set_paused(&mut self,x:bool){self.paused=x}
 pub fn update_ephemerides(&mut self)->Result<(),String>{self.ready()?;if self.nbody.is_some(){return self.sync_n_body_states()}for i in 0..self.bodies.len(){let Some(pid)=self.bodies[i].parent_id.as_ref()else{continue};let pi=self.indices[pid];let init=self.initial[i].ok_or("Missing initial relative state.")?;let rel=propagate_kepler(init.position,init.velocity,G*(self.bodies[i].mass_kg+self.bodies[pi].mass_kg),self.simulation_time_seconds,1e-10,100)?;let ps=self.states[pi];self.states[i]=BodyState::new(ps.p().add(rel.position),ps.vel().add(rel.velocity));}Ok(())}
 pub fn body_states_at(&mut self,t:f64)->Result<Vec<f64>,String>{self.ready()?;if !t.is_finite(){return Err("timeSeconds must be finite.".into())}if let Some(system)=&self.nbody{let projected=system.advanced(t-self.simulation_time_seconds,self.options.fixed_step_seconds)?;let mut out=Vec::with_capacity(projected.bodies().len()*6);for body in projected.bodies(){out.extend_from_slice(&arr(body.position));out.extend_from_slice(&arr(body.velocity));}return Ok(out)}let mut out=Vec::with_capacity(self.bodies.len()*6);let mut computed:Vec<BodyState>=Vec::with_capacity(self.bodies.len());for i in 0..self.bodies.len(){let b=&self.bodies[i];let s=if let Some(pid)=&b.parent_id{let pi=self.indices[pid];let init=self.initial[i].ok_or("Missing initial relative state.")?;let rel=propagate_kepler(init.position,init.velocity,G*(b.mass_kg+self.bodies[pi].mass_kg),t,1e-10,100)?;BodyState::new(computed[pi].p().add(rel.position),computed[pi].vel().add(rel.velocity))}else{BodyState{position:b.position,velocity:b.velocity}};out.extend_from_slice(&s.position);out.extend_from_slice(&s.velocity);computed.push(s)}Ok(out)}
 fn choose_primary(&self,vessel:&Vessel)->Result<String,String>{let ci=*self.indices.get(&vessel.primary).ok_or("Missing current primary.")?;let current=&self.bodies[ci];if let Some(pid)=&current.parent_id{if let Some(soi)=self.sphere_of_influence(&current.id){if vessel.p.sub(self.states[ci].p()).norm()>soi*self.options.soi_exit_factor{return Ok(pid.clone())}}}let mut best:Option<(String,f64)>=None;for(i,b)in self.bodies.iter().enumerate(){if b.parent_id.as_deref()!=Some(current.id.as_str()){continue}if let Some(soi)=self.sphere_of_influence(&b.id){let d=vessel.p.sub(self.states[i].p()).norm();if d<soi*self.options.soi_enter_factor&&best.as_ref().map(|x|soi<x.1).unwrap_or(true){best=Some((b.id.clone(),soi))}}}Ok(best.map(|x|x.0).unwrap_or_else(||current.id.clone()))}
 fn switch_primary(&mut self,i:usize,next:String){if self.vessels[i].primary==next{return}let ni=self.indices[&next];let state=self.states[ni];let old=self.vessels[i].primary.clone();let x=&mut self.vessels[i];x.r=x.p.sub(state.p());x.v=x.vel.sub(state.vel());let change=PrimarySwitch{from:old,to:next.clone(),time_seconds:self.simulation_time_seconds};x.last=Some(change.clone());x.history.push(change);x.primary=next}
 pub fn step(&mut self)->Result<(),String>{self.ready()?;if self.nbody.is_some(){return self.step_n_body()}self.simulation_time_seconds+=self.options.fixed_step_seconds;self.update_ephemerides()?;let gravity_bodies:Vec<(f64,f64,Vec3)>=self.bodies.iter().zip(self.states.iter()).map(|(b,s)|(b.mass_kg,b.mean_radius_m,s.p())).collect();for i in 0..self.vessels.len(){if self.vessels[i].engines.is_empty(){let pi=self.indices[&self.vessels[i].primary];let ps=self.states[pi];let mu=G*self.bodies[pi].mass_kg;let next=propagate_kepler(self.vessels[i].r,self.vessels[i].v,mu,self.options.fixed_step_seconds,1e-10,100)?;self.vessels[i].r=next.position;self.vessels[i].v=next.velocity;self.vessels[i].p=ps.p().add(next.position);self.vessels[i].vel=ps.vel().add(next.velocity);}else{let vessel=&mut self.vessels[i];let diagnostics=integrate_engines(&mut vessel.p,&mut vessel.vel,&mut vessel.mass,&mut vessel.engines,self.options.fixed_step_seconds,|position|gravity_from_bodies(&gravity_bodies,position))?;vessel.last_thrust_n=diagnostics.thrust_n;vessel.last_mass_flow_kg_s=diagnostics.mass_flow_kg_s;vessel.last_acceleration_m_s2=diagnostics.acceleration_m_s2;let pi=self.indices[&vessel.primary];vessel.r=vessel.p.sub(self.states[pi].p());vessel.v=vessel.vel.sub(self.states[pi].vel());}let primary=self.choose_primary(&self.vessels[i])?;self.switch_primary(i,primary)}Ok(())}
 pub fn advance(&mut self,dt:f64)->Result<u32,String>{if !dt.is_finite()||dt<0.0{return Err("realDeltaSeconds must be finite and non-negative.".into())}if self.paused||self.time_scale==0.0||dt==0.0{return Ok(0)}let total=self.accumulator_seconds+dt*self.time_scale;if !total.is_finite(){return Err("Physics accumulator overflow.".into())}let count=(total/self.options.fixed_step_seconds).floor();if count>self.options.max_sub_steps as f64{return Err("Physics backlog exceeds maxSubSteps.".into())}let n=count as u32;let old_time=self.simulation_time_seconds;let old_states=self.states.clone();let old_vessels=self.vessels.clone();let old_nbody=self.nbody.clone();for _ in 0..n{if let Err(e)=self.step(){self.simulation_time_seconds=old_time;self.states=old_states;self.vessels=old_vessels;self.nbody=old_nbody;return Err(e)}}self.accumulator_seconds=(total-n as f64*self.options.fixed_step_seconds).max(0.0);Ok(n)}
 pub fn add_engine(&mut self,vessel_id:&str,mut engine:Engine)->Result<(),String>{engine.validate()?;let i=*self.vessel_indices.get(vessel_id).ok_or_else(||format!("Unknown vessel: {vessel_id}"))?;if self.vessels[i].engines.iter().any(|item|item.id==engine.id){return Err(format!("Duplicate engine id: {}",engine.id))}self.vessels[i].mass+=engine.propellant_kg;self.vessels[i].engines.push(engine);Ok(())}
 pub fn start_engine_burn(&mut self,vessel_id:&str,engine_id:&str,duration:f64)->Result<(),String>{if !duration.is_finite()||duration<=0.0{return Err("burnDurationSeconds must be finite and positive.".into())}let i=*self.vessel_indices.get(vessel_id).ok_or_else(||format!("Unknown vessel: {vessel_id}"))?;let engine=self.vessels[i].engines.iter_mut().find(|e|e.id==engine_id).ok_or_else(||format!("Unknown engine: {engine_id}"))?;if engine.propellant_kg<=1.0e-12{return Err("Engine has no propellant remaining.".into())}engine.burn_remaining_seconds=Some(duration);engine.enabled=true;Ok(())}
 pub fn set_engine_enabled(&mut self,vessel_id:&str,engine_id:&str,enabled:bool)->Result<(),String>{let i=*self.vessel_indices.get(vessel_id).ok_or_else(||format!("Unknown vessel: {vessel_id}"))?;let engine=self.vessels[i].engines.iter_mut().find(|e|e.id==engine_id).ok_or_else(||format!("Unknown engine: {engine_id}"))?;engine.enabled=enabled;if !enabled{engine.burn_remaining_seconds=None;}Ok(())}
 pub fn set_engine_throttle(&mut self,vessel_id:&str,engine_id:&str,throttle:f64)->Result<(),String>{if !throttle.is_finite()||!(0.0..=1.0).contains(&throttle){return Err("throttle must be in [0, 1].".into())}let i=*self.vessel_indices.get(vessel_id).ok_or_else(||format!("Unknown vessel: {vessel_id}"))?;let engine=self.vessels[i].engines.iter_mut().find(|e|e.id==engine_id).ok_or_else(||format!("Unknown engine: {engine_id}"))?;engine.throttle=throttle;Ok(())}
 pub fn set_engine_direction(&mut self,vessel_id:&str,engine_id:&str,direction:[f64;3])->Result<(),String>{let direction=v(direction)?.normalized()?;let i=*self.vessel_indices.get(vessel_id).ok_or_else(||format!("Unknown vessel: {vessel_id}"))?;let engine=self.vessels[i].engines.iter_mut().find(|e|e.id==engine_id).ok_or_else(||format!("Unknown engine: {engine_id}"))?;engine.direction=arr(direction);Ok(())}
 pub fn propulsion_state(&self,vessel_id:&str)->Result<serde_json::Value,String>{let i=*self.vessel_indices.get(vessel_id).ok_or_else(||format!("Unknown vessel: {vessel_id}"))?;let vessel=&self.vessels[i];let mut force=Vec3::new(0.0,0.0,0.0);let mut flow=0.0;for engine in &vessel.engines{if engine.enabled&&engine.throttle>0.0&&engine.propellant_kg>1.0e-12{let thrust=engine.max_thrust_n*engine.throttle;force=force.add(Vec3::new(engine.direction[0],engine.direction[1],engine.direction[2]).scale(thrust));flow+=thrust/(engine.isp_seconds*STANDARD_G);}}let gravity_bodies:Vec<(f64,f64,Vec3)>=self.bodies.iter().zip(self.states.iter()).map(|(b,state)|(b.mass_kg,b.mean_radius_m,state.p())).collect();let acceleration=gravity_from_bodies(&gravity_bodies,vessel.p)?.add(force.scale(1.0/vessel.mass)).norm();Ok(serde_json::json!({"vesselId":vessel.id,"massKg":vessel.mass,"thrustN":force.norm(),"massFlowKgS":flow,"accelerationMS2":acceleration,"propellantRemainingKg":vessel.engines.iter().map(|e|e.propellant_kg).sum::<f64>(),"engines":&vessel.engines}))}
 pub fn vessel_state(&self,id:&str)->Result<VesselState,String>{let i=*self.vessel_indices.get(id).ok_or_else(||format!("Unknown vessel: {id}"))?;Ok(self.vessels[i].snapshot())}
 pub fn vessel_states(&self)->Vec<VesselState>{self.vessels.iter().map(Vessel::snapshot).collect()}
 pub fn vessel_state_at(&self,id:&str,t:f64,body_states:&[f64])->Result<VesselState,String>{if !t.is_finite(){return Err("timeSeconds must be finite.".into())}let i=*self.vessel_indices.get(id).ok_or_else(||format!("Unknown vessel: {id}"))?;let vessel=&self.vessels[i];let pi=self.indices[&vessel.primary];if body_states.len()!=self.bodies.len()*6{return Err("Invalid body snapshot length.".into())}let k=pi*6;let p=Vec3::new(body_states[k],body_states[k+1],body_states[k+2]);let vel=Vec3::new(body_states[k+3],body_states[k+4],body_states[k+5]);let dt=t-self.simulation_time_seconds;if !vessel.engines.is_empty()&&dt>0.0{let gravity_bodies:Vec<(f64,f64,Vec3)>=self.bodies.iter().enumerate().map(|(index,b)|(b.mass_kg,b.mean_radius_m,Vec3::new(body_states[index*6],body_states[index*6+1],body_states[index*6+2]))).collect();let mut absolute_position=vessel.p;let mut absolute_velocity=vessel.vel;let mut mass=vessel.mass;let mut engines=vessel.engines.clone();integrate_engines(&mut absolute_position,&mut absolute_velocity,&mut mass,&mut engines,dt,|position|gravity_from_bodies(&gravity_bodies,position))?;return Ok(VesselState{position:arr(absolute_position),velocity:arr(absolute_velocity),relative_position:arr(absolute_position.sub(p)),relative_velocity:arr(absolute_velocity.sub(vel)),mass_kg:mass,..vessel.snapshot()})}let rel=if let Some(system)=&self.nbody{let projected=system.advanced(dt,self.options.fixed_step_seconds)?;let(absolute_position,absolute_velocity)=NBodySystem::integrate_test_particle(system,&projected,vessel.p,vessel.vel,dt)?;let relative_position=absolute_position.sub(p);let relative_velocity=absolute_velocity.sub(vel);return Ok(VesselState{position:arr(absolute_position),velocity:arr(absolute_velocity),relative_position:arr(relative_position),relative_velocity:arr(relative_velocity),..vessel.snapshot()})}else{propagate_kepler(vessel.r,vessel.v,G*self.bodies[pi].mass_kg,dt,1e-10,100)?};Ok(VesselState{position:arr(p.add(rel.position)),velocity:arr(vel.add(rel.velocity)),relative_position:arr(rel.position),relative_velocity:arr(rel.velocity),..vessel.snapshot()})}
 pub fn apply_impulse(&mut self,id:&str,direction:[f64;3],dv:f64)->Result<(),String>{if !dv.is_finite()||dv<0.0{return Err("deltaVMS must be non-negative.".into())}let dir=v(direction)?.normalized()?;let i=*self.vessel_indices.get(id).ok_or_else(||format!("Unknown vessel: {id}"))?;let pi=self.indices[&self.vessels[i].primary];self.vessels[i].v=self.vessels[i].v.add(dir.scale(dv));self.vessels[i].vel=self.states[pi].vel().add(self.vessels[i].v);Ok(())}
 pub fn apply_idealized_burn(&mut self,id:&str,direction:[f64;3],dv:f64,vacuum:f64,sea:f64,isp:f64,ambient:f64,reference:f64,dry:f64)->Result<BurnResult,String>{
  positive(vacuum,"vacuumThrustN")?;positive(isp,"ispSeconds")?;positive(reference,"referencePressurePa")?;positive(dry,"dryMassKg")?;
  if !sea.is_finite()||sea<0.0||sea>vacuum{return Err("seaLevelThrustN must be between zero and vacuum thrust.".into())}
  if !ambient.is_finite()||ambient<0.0{return Err("ambientPressurePa must be non-negative.".into())}
  if !dv.is_finite()||dv<0.0{return Err("deltaVMS must be non-negative.".into())}
  let i=*self.vessel_indices.get(id).ok_or_else(||format!("Unknown vessel: {id}"))?;let initial=self.vessels[i].mass;
  if dry>=initial{return Err("Dry mass must be smaller than initial mass.".into())}
  let thrust=vacuum+(sea-vacuum)*(ambient/reference).min(1.0);let final_mass=initial/((dv/(isp*STANDARD_G)).exp());
  if final_mass<dry{return Err("Requested burn exceeds available propellant.".into())}
  let flow=thrust/(isp*STANDARD_G);let used=initial-final_mass;
  self.apply_impulse(id,direction,dv)?;self.vessels[i].mass=final_mass;
  Ok(BurnResult{initial_mass_kg:initial,final_mass_kg:final_mass,propellant_used_kg:used,burn_duration_seconds:used/flow,mass_flow_kg_s:flow,delta_v_m_s:dv,thrust_n:thrust,thrust_to_weight_ratio:thrust/(final_mass*STANDARD_G)})
 }
 pub fn rotation_angles_at(&self,t:f64)->Result<Vec<f64>,String>{if !t.is_finite(){return Err("timeSeconds must be finite.".into())}self.bodies.iter().map(|b|self.rotation_angle_at(&b.id,t).map(|x|x.unwrap_or(f64::NAN))).collect()}
 pub fn rotation_angle_at(&self,id:&str,t:f64)->Result<Option<f64>,String>{let b=self.body(id).ok_or_else(||format!("Unknown body: {id}"))?;if !t.is_finite(){return Err("time must be finite.".into())}Ok(b.rotation_period_seconds.filter(|_|!b.tidal_lock).map(|p|b.prime_meridian_rad+b.rotation_direction as f64*std::f64::consts::TAU*((t-b.rotation_epoch_seconds)/p)))}
}
#[cfg(test)]mod tests{use super::*;
#[test]fn finite_thrust_is_integrated_with_gravity_and_consumes_propellant(){
 let mut w=PhysicsWorld::new(Options{fixed_step_seconds:1.0,max_sub_steps:10,soi_enter_factor:0.9,soi_exit_factor:1.1}).unwrap();
 w.add_body(body()).unwrap();
 w.add_vessel(VesselDefinition{id:"ship".into(),primary_body_id:"earth".into(),position:[7_000_000.0,0.0,0.0],velocity:[0.0,0.0,0.0],mass_kg:1000.0,engines:Vec::new()}).unwrap();
 w.add_engine("ship",Engine{id:"main".into(),name:"Main".into(),max_thrust_n:10_000.0,isp_seconds:300.0,direction:[0.0,1.0,0.0],mount_position_m:[0.0;3],throttle:1.0,enabled:true,propellant_kg:10.0,burn_remaining_seconds:None}).unwrap();
 let before=w.vessel_state("ship").unwrap();w.step().unwrap();let after=w.vessel_state("ship").unwrap();
 assert!(after.velocity[1]>before.velocity[1]);
 assert!(after.mass_kg<before.mass_kg);
 let telemetry=w.propulsion_state("ship").unwrap();
 assert!(telemetry["propellantRemainingKg"].as_f64().unwrap()<10.0);
 assert!(telemetry["thrustN"].as_f64().unwrap()>9_999.0);
}
#[test]fn fractional_snapshot_integrates_continuous_engine_burn(){
 let mut w=PhysicsWorld::new(Options{fixed_step_seconds:1.0,max_sub_steps:10,soi_enter_factor:0.9,soi_exit_factor:1.1}).unwrap();
 w.add_body(body()).unwrap();
 w.add_vessel(VesselDefinition{id:"ship".into(),primary_body_id:"earth".into(),position:[7_000_000.0,0.0,0.0],velocity:[0.0,0.0,0.0],mass_kg:1000.0,engines:Vec::new()}).unwrap();
 w.add_engine("ship",Engine{id:"main".into(),name:"Main".into(),max_thrust_n:1000.0,isp_seconds:300.0,direction:[0.0,1.0,0.0],mount_position_m:[0.0;3],throttle:1.0,enabled:true,propellant_kg:10.0,burn_remaining_seconds:None}).unwrap();
 let states=w.body_states_at(0.5).unwrap();let predicted=w.vessel_state_at("ship",0.5,&states).unwrap();
 assert!(predicted.velocity[1]>0.0);assert!(predicted.mass_kg<1010.0);assert_eq!(w.simulation_time_seconds,0.0);
}
#[test]fn engine_throttle_and_shutdown_are_respected(){
 let mut w=PhysicsWorld::new(Options{fixed_step_seconds:1.0,max_sub_steps:10,soi_enter_factor:0.9,soi_exit_factor:1.1}).unwrap();
 w.add_body(body()).unwrap();
 w.add_vessel(VesselDefinition{id:"ship".into(),primary_body_id:"earth".into(),position:[7_000_000.0,0.0,0.0],velocity:[0.0,0.0,0.0],mass_kg:1000.0,engines:Vec::new()}).unwrap();
 w.add_engine("ship",Engine{id:"main".into(),name:"Main".into(),max_thrust_n:1000.0,isp_seconds:300.0,direction:[0.0,1.0,0.0],mount_position_m:[0.0;3],throttle:0.5,enabled:true,propellant_kg:10.0,burn_remaining_seconds:None}).unwrap();
 w.step().unwrap();let running=w.vessel_state("ship").unwrap();
 w.set_engine_enabled("ship","main",false).unwrap();w.step().unwrap();let stopped=w.vessel_state("ship").unwrap();
 assert!(running.mass_kg>stopped.mass_kg);
 assert!(w.propulsion_state("ship").unwrap()["thrustN"].as_f64().unwrap()==0.0);
}
#[test]fn n_body_mode_is_barycentric_and_keeps_vessel_relative_state_continuous(){let mut w=PhysicsWorld::new(Options{fixed_step_seconds:60.0,max_sub_steps:100,soi_enter_factor:0.9,soi_exit_factor:1.1}).unwrap();let sun:BodyDefinition=serde_json::from_str(r#"{"id":"sun","name":"Sun","massKg":1.98847e30,"meanRadiusM":6.957e8}"#).unwrap();w.add_body(sun).unwrap();let earth:BodyDefinition=serde_json::from_str(r#"{"id":"earth","name":"Earth","massKg":5.9722e24,"meanRadiusM":6.371e6,"parentId":"sun","orbitalElements":{"semiMajorAxisM":149597870700.0,"eccentricity":0.0167,"meanAnomaly":0.0}}"#).unwrap();w.add_body(earth).unwrap();w.initialize_ephemerides().unwrap();let earth_state=w.body_state("earth").unwrap();w.add_vessel(VesselDefinition{id:"ship".into(),primary_body_id:"earth".into(),position:[earth_state.position[0]+7.0e6,earth_state.position[1],earth_state.position[2]],velocity:earth_state.velocity,mass_kg:1000.0,engines:Vec::new()}).unwrap();let vessel_before=w.vessel_state("ship").unwrap();w.enable_n_body().unwrap();let vessel_after=w.vessel_state("ship").unwrap();for axis in 0..3{assert!((vessel_before.relative_position[axis]-vessel_after.relative_position[axis]).abs()<1.0e-4);assert!((vessel_before.relative_velocity[axis]-vessel_after.relative_velocity[axis]).abs()<1.0e-10);}let momentum=w.nbody.as_ref().unwrap().total_momentum();let momentum_scale=w.bodies.iter().zip(w.states.iter()).map(|(body,state)|body.mass_kg*state.vel().norm()).sum::<f64>().max(1.0);assert!(momentum.norm()/momentum_scale<1.0e-14);let sun_before=w.body_state("sun").unwrap().position;w.step().unwrap();let sun_after=w.body_state("sun").unwrap().position;assert_ne!(sun_before,sun_after);assert!(w.n_body_enabled());}#[test]fn max_substep_backlog_rejection_preserves_accumulator_and_simulation_time(){let mut w=PhysicsWorld::new(Options{fixed_step_seconds:1.0,max_sub_steps:2,soi_enter_factor:0.9,soi_exit_factor:1.1}).unwrap();w.add_body(body()).unwrap();assert!(w.advance(3.0).is_err());assert_eq!(w.simulation_time_seconds,0.0);assert_eq!(w.accumulator_seconds,0.0);assert!(w.set_time_scale(-1.0).is_err());}fn body()->BodyDefinition{serde_json::from_str(r#"{"id":"earth","name":"Earth","massKg":5.9722e24,"meanRadiusM":6371000}"#).unwrap()}#[test]fn clock_pause_scale(){let mut w=PhysicsWorld::new(Options{fixed_step_seconds:1.0,max_sub_steps:100,soi_enter_factor:0.9,soi_exit_factor:1.1}).unwrap();w.add_body(body()).unwrap();w.set_time_scale(2.0).unwrap();assert_eq!(w.advance(1.5).unwrap(),3);assert_eq!(w.simulation_time_seconds,3.0);w.set_paused(true);assert_eq!(w.advance(10.0).unwrap(),0)}#[test]fn rejects_duplicate_and_missing_parent(){let mut w=PhysicsWorld::new(Options::default()).unwrap();w.add_body(body()).unwrap();assert!(w.add_body(body()).is_err());let moon:BodyDefinition=serde_json::from_str(r#"{"id":"moon","name":"Moon","massKg":7e22,"meanRadiusM":1e6,"parentId":"missing"}"#).unwrap();assert!(w.add_body(moon).is_err())}#[test]fn fractional_snapshots_do_not_mutate_world(){let mut w=PhysicsWorld::new(Options::default()).unwrap();w.add_body(body()).unwrap();let a=w.body_states_at(30.0).unwrap();let b=w.body_states_at(30.0).unwrap();assert_eq!(a,b);assert_eq!(w.simulation_time_seconds,0.0)}}
