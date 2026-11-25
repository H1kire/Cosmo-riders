use wasm_bindgen::prelude::*;
use js_sys::{Float32Array,Float64Array,Object,Reflect,Uint32Array,Uint8Array};
use crate::{geometry,physics::{self,Vec3},surface::{self,SurfaceProfile}};

fn js_error(message:impl ToString)->JsValue{JsValue::from_str(&message.to_string())}
fn set(object:&Object,key:&str,value:&JsValue)->Result<(),JsValue>{Reflect::set(object,&JsValue::from_str(key),value).map(|_|())}

#[wasm_bindgen]
pub fn core_version()->String{env!("CARGO_PKG_VERSION").to_string()}

#[wasm_bindgen]
pub fn propagate_kepler(position:Float64Array,velocity:Float64Array,mu:f64,delta_time_seconds:f64,tolerance:f64,max_iterations:u32)->Result<Float64Array,JsValue>{
 if position.length()!=3||velocity.length()!=3{return Err(js_error("Position and velocity arrays must contain exactly three values."));}
 let mut p=[0.0;3];let mut v=[0.0;3];position.copy_to(&mut p);velocity.copy_to(&mut v);
 let state=physics::propagate_kepler(Vec3::new(p[0],p[1],p[2]),Vec3::new(v[0],v[1],v[2]),mu,delta_time_seconds,tolerance,max_iterations).map_err(js_error)?;
 Ok(Float64Array::from(&[state.position.x,state.position.y,state.position.z,state.velocity.x,state.velocity.y,state.velocity.z,state.iterations as f64][..]))
}

#[wasm_bindgen]
pub fn state_to_orbital_elements(position:Float64Array,velocity:Float64Array,mu:f64)->Result<Float64Array,JsValue>{
 if position.length()!=3||velocity.length()!=3{return Err(js_error("Position and velocity arrays must contain exactly three values."));}
 let mut p=[0.0;3];let mut v=[0.0;3];position.copy_to(&mut p);velocity.copy_to(&mut v);
 let e=physics::state_to_elements(Vec3::new(p[0],p[1],p[2]),Vec3::new(v[0],v[1],v[2]),mu).map_err(js_error)?;
 Ok(Float64Array::from(&[e.semi_major_axis,e.eccentricity,e.inclination,e.longitude_ascending_node,e.argument_of_periapsis,e.true_anomaly,e.specific_energy,e.specific_angular_momentum][..]))
}

#[wasm_bindgen]
pub fn conic_elements_to_state(semilatus_rectum:f64,eccentricity:f64,inclination:f64,longitude_ascending_node:f64,argument_of_periapsis:f64,true_anomaly:f64,mu:f64)->Result<Float64Array,JsValue>{
 let(r,v)=physics::conic_elements_to_state(semilatus_rectum,eccentricity,inclination,longitude_ascending_node,argument_of_periapsis,true_anomaly,mu).map_err(js_error)?;
 Ok(Float64Array::from(&[r.x,r.y,r.z,v.x,v.y,v.z][..]))
}

#[wasm_bindgen]
pub fn orbital_elements_to_state(semi_major_axis:f64,eccentricity:f64,inclination:f64,longitude_ascending_node:f64,argument_of_periapsis:f64,mean_anomaly:f64,mu:f64)->Result<Float64Array,JsValue>{
 let(r,v)=physics::orbital_elements_to_state(semi_major_axis,eccentricity,inclination,longitude_ascending_node,argument_of_periapsis,mean_anomaly,mu).map_err(js_error)?;
 Ok(Float64Array::from(&[r.x,r.y,r.z,v.x,v.y,v.z][..]))
}

#[wasm_bindgen]
pub fn generate_surface_tile(face:u32,path:String,resolution:u32,gutter:u32,profile_json:String)->Result<JsValue,JsValue>{
 let profile:SurfaceProfile=serde_json::from_str(&profile_json).map_err(js_error)?;
 let tile=surface::generate_tile(face,&path,resolution,gutter,&profile).map_err(js_error)?;
 let object=Object::new();
 set(&object,"albedo",&Uint8Array::from(tile.albedo.as_slice()).into())?;
 set(&object,"normal",&Uint8Array::from(tile.normal.as_slice()).into())?;
 set(&object,"height",&Float32Array::from(tile.height.as_slice()).into())?;
 set(&object,"roughness",&Uint8Array::from(tile.roughness.as_slice()).into())?;
 set(&object,"materialId",&Uint8Array::from(tile.material.as_slice()).into())?;
 set(&object,"resolution",&JsValue::from_f64(resolution as f64))?;
 set(&object,"gutter",&JsValue::from_f64(gutter as f64))?;
 Ok(object.into())
}

#[wasm_bindgen]
pub fn build_geodesic_tile_mesh(face:u32,path:String,resolution:u32,radius_m:f64)->Result<JsValue,JsValue>{
 let tile=geometry::resolve_tile(face,&path).map_err(js_error)?;
 let mesh=geometry::build_tile_mesh(&tile,resolution,radius_m).map_err(js_error)?;
 let object=Object::new();
 set(&object,"tileKey",&JsValue::from_str(&format!("{}:{}",face,if path.is_empty(){"root"}else{&path})))?;
 set(&object,"resolution",&JsValue::from_f64(resolution as f64))?;
 set(&object,"radiusM",&JsValue::from_f64(radius_m))?;
 set(&object,"directions",&Float32Array::from(mesh.directions.as_slice()).into())?;
 set(&object,"positionsM",&Float32Array::from(mesh.positions.as_slice()).into())?;
 set(&object,"normals",&Float32Array::from(mesh.normals.as_slice()).into())?;
 set(&object,"textureCoordinates",&Float32Array::from(mesh.uv.as_slice()).into())?;
 set(&object,"indices",&Uint32Array::from(mesh.indices.as_slice()).into())?;
 Ok(object.into())
}


/// Build a conforming index buffer for a triangular geodesic tile.
#[wasm_bindgen]
pub fn build_geodesic_stitch_indices(resolution:u32,coarse_edge_mask:u32)->Result<Uint32Array,JsValue>{
 let indices=geometry::build_stitch_indices(resolution,coarse_edge_mask).map_err(js_error)?;
 Ok(Uint32Array::from(indices.as_slice()))
}

/// Point-mass gravitational acceleration. Inputs use SI units.
#[wasm_bindgen]
pub fn gravitational_acceleration(position:Float64Array,mu:f64)->Result<Float64Array,JsValue>{
 if position.length()!=3{return Err(js_error("Position array must contain exactly three values."));}
 let mut p=[0.0;3];position.copy_to(&mut p);
 let vector=Vec3::new(p[0],p[1],p[2]);
 if !vector.finite()||!mu.is_finite()||mu<=0.0{return Err(js_error("Position and gravitational parameter must be finite; mu must be positive."));}
 let radius=vector.norm();if radius==0.0{return Err(js_error("Acceleration is undefined at the point-mass centre."));}
 let acceleration=vector.scale(-mu/(radius*radius*radius));
 Ok(Float64Array::from(&[acceleration.x,acceleration.y,acceleration.z][..]))
}

/// Specific orbital energy in joules per kilogram.
#[wasm_bindgen]
pub fn specific_orbital_energy(position:Float64Array,velocity:Float64Array,mu:f64)->Result<f64,JsValue>{
 if position.length()!=3||velocity.length()!=3{return Err(js_error("Position and velocity arrays must contain exactly three values."));}
 let mut p=[0.0;3];let mut v=[0.0;3];position.copy_to(&mut p);velocity.copy_to(&mut v);
 let r=Vec3::new(p[0],p[1],p[2]);let speed=Vec3::new(v[0],v[1],v[2]);
 if !r.finite()||!speed.finite()||!mu.is_finite()||mu<=0.0{return Err(js_error("State and gravitational parameter must be finite; mu must be positive."));}
 let radius=r.norm();if radius==0.0{return Err(js_error("Orbital energy is undefined at the point-mass centre."));}
 Ok(0.5*speed.norm2()-mu/radius)
}
