use crate::physics_world::{BodyDefinition,Options,PhysicsWorld,VesselDefinition};
use js_sys::{Array,Float64Array,Object};
use wasm_bindgen::prelude::*;
fn error(v:impl ToString)->JsValue{JsValue::from_str(&v.to_string())}
fn set(o:&Object,k:&str,v:&JsValue)->Result<(),JsValue>{js_sys::Reflect::set(o,&JsValue::from_str(k),v).map(|_|())}
#[wasm_bindgen] pub struct PhysicsWorldHandle{world:Option<PhysicsWorld>}
impl PhysicsWorldHandle{fn w(&self)->Result<&PhysicsWorld,JsValue>{self.world.as_ref().ok_or_else(||error("PhysicsWorld handle disposed."))}fn wm(&mut self)->Result<&mut PhysicsWorld,JsValue>{self.world.as_mut().ok_or_else(||error("PhysicsWorld handle disposed."))}}
#[wasm_bindgen] pub fn create_physics_world(catalog:String,options:String)->Result<PhysicsWorldHandle,JsValue>{let bodies:Vec<BodyDefinition>=serde_json::from_str(&catalog).map_err(error)?;let o=if options.trim().is_empty(){Options::default()}else{serde_json::from_str(&options).map_err(error)?};let mut w=PhysicsWorld::new(o).map_err(error)?;for b in bodies{w.add_body(b).map_err(error)?;}w.initialize_ephemerides().map_err(error)?;Ok(PhysicsWorldHandle{world:Some(w)})}
#[wasm_bindgen] impl PhysicsWorldHandle{
 pub fn add_celestial_body(&mut self,json:String)->Result<(),JsValue>{let b:BodyDefinition=serde_json::from_str(&json).map_err(error)?;self.wm()?.add_body(b).map_err(error)}
 pub fn initialize_ephemerides(&mut self)->Result<(),JsValue>{self.wm()?.initialize_ephemerides().map_err(error)}
 pub fn add_vessel(&mut self,json:String)->Result<(),JsValue>{let v:VesselDefinition=serde_json::from_str(&json).map_err(error)?;self.wm()?.add_vessel(v).map_err(error)}
 pub fn set_time_scale(&mut self,x:f64)->Result<(),JsValue>{self.wm()?.set_time_scale(x).map_err(error)}
 pub fn set_paused(&mut self,x:bool){if let Some(w)=self.world.as_mut(){w.set_paused(x)}}
 pub fn advance_simulation(&mut self,dt:f64)->Result<u32,JsValue>{self.wm()?.advance(dt).map_err(error)}
 pub fn step_simulation(&mut self)->Result<(),JsValue>{self.wm()?.step().map_err(error)}
 pub fn get_body_states_at(&mut self,t:f64)->Result<Float64Array,JsValue>{let a=self.wm()?.body_states_at(t).map_err(error)?;Ok(Float64Array::from(a.as_slice()))}
 pub fn get_body_states(&mut self)->Result<Float64Array,JsValue>{let t=self.w()?.simulation_time_seconds;self.get_body_states_at(t)}
 pub fn get_vessel_state(&self,id:String)->Result<String,JsValue>{serde_json::to_string(&self.w()?.vessel_state(&id).map_err(error)?).map_err(error)}
 pub fn get_vessel_state_at(&mut self,id:String,t:f64,states:Float64Array)->Result<String,JsValue>{let mut a=vec![0.0;states.length() as usize];states.copy_to(&mut a);let s=self.wm()?.vessel_state_at(&id,t,&a).map_err(error)?;serde_json::to_string(&s).map_err(error)}
 pub fn get_sphere_of_influence(&self,id:String)->Option<f64>{self.world.as_ref()?.sphere_of_influence(&id)}
 pub fn apply_maneuver(&mut self,id:String,d:Float64Array,dv:f64)->Result<(),JsValue>{if d.length()!=3{return Err(error("Direction needs three components."))}let mut a=[0.0;3];d.copy_to(&mut a);self.wm()?.apply_impulse(&id,a,dv).map_err(error)}
 pub fn get_rotation_angle_at(&self,id:String,t:f64)->Result<f64,JsValue>{Ok(self.w()?.rotation_angle_at(&id,t).map_err(error)?.unwrap_or(0.0))}
 pub fn get_physics_snapshot(&mut self)->Result<JsValue,JsValue>{let w=self.wm()?;let t=w.simulation_time_seconds;let states=w.body_states_at(t).map_err(error)?;let ids=Array::new();for id in w.body_ids(){ids.push(&JsValue::from_str(&id))}let vessels=w.vessel_states();let vids=Array::new();let mut packed=Vec::with_capacity(vessels.len()*13);for v in vessels{vids.push(&JsValue::from_str(&v.id));packed.extend_from_slice(&v.position);packed.extend_from_slice(&v.velocity);packed.extend_from_slice(&v.relative_position);packed.extend_from_slice(&v.relative_velocity);packed.push(v.mass_kg)}let o=Object::new();set(&o,"simulationTimeSeconds",&JsValue::from_f64(w.simulation_time_seconds))?;set(&o,"accumulatorSeconds",&JsValue::from_f64(w.accumulator_seconds))?;set(&o,"timeScale",&JsValue::from_f64(w.time_scale))?;set(&o,"paused",&JsValue::from_bool(w.paused))?;set(&o,"bodyIds",&ids.into())?;set(&o,"bodyStates",&Float64Array::from(states.as_slice()).into())?;set(&o,"vesselIds",&vids.into())?;set(&o,"vesselStates",&Float64Array::from(packed.as_slice()).into())?;Ok(o.into())}
 pub fn dispose_physics_world(&mut self){self.world=None}
}
