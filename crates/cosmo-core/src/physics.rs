use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Vec3 { pub x: f64, pub y: f64, pub z: f64 }

impl Vec3 {
    pub fn new(x:f64,y:f64,z:f64)->Self { Self{x,y,z} }
    pub fn dot(self,b:Self)->f64 { self.x*b.x+self.y*b.y+self.z*b.z }
    pub fn cross(self,b:Self)->Self { Self::new(self.y*b.z-self.z*b.y,self.z*b.x-self.x*b.z,self.x*b.y-self.y*b.x) }
    pub fn norm2(self)->f64 { self.dot(self) }
    pub fn norm(self)->f64 { self.norm2().sqrt() }
    pub fn add(self,b:Self)->Self { Self::new(self.x+b.x,self.y+b.y,self.z+b.z) }
    pub fn sub(self,b:Self)->Self { Self::new(self.x-b.x,self.y-b.y,self.z-b.z) }
    pub fn scale(self,s:f64)->Self { Self::new(self.x*s,self.y*s,self.z*s) }
    pub fn normalized(self)->Result<Self,String> { let n=self.norm(); if n==0.0||!n.is_finite(){Err("Cannot normalize a zero or non-finite vector.".into())}else{Ok(self.scale(1.0/n))} }
    pub fn finite(self)->bool { self.x.is_finite()&&self.y.is_finite()&&self.z.is_finite() }
}

pub fn stumpff_c(z:f64)->Result<f64,String>{
    if !z.is_finite(){return Err("z must be finite.".into());}
    if z.abs()<1e-8{return Ok(0.5-z/24.0+z*z/720.0-z*z*z/40320.0);}
    if z>0.0{let q=z.sqrt();return Ok((1.0-q.cos())/z);}
    let q=(-z).sqrt();if q>350.0{return Err("Hyperbolic anomaly exceeds stable numeric range.".into());}
    Ok((q.cosh()-1.0)/(-z))
}
pub fn stumpff_s(z:f64)->Result<f64,String>{
    if !z.is_finite(){return Err("z must be finite.".into());}
    if z.abs()<1e-8{return Ok(1.0/6.0-z/120.0+z*z/5040.0-z*z*z/362880.0);}
    if z>0.0{let q=z.sqrt();return Ok((q-q.sin())/(q*q*q));}
    let q=(-z).sqrt();if q>350.0{return Err("Hyperbolic anomaly exceeds stable numeric range.".into());}
    Ok((q.sinh()-q)/(q*q*q))
}

#[derive(Clone, Copy, Debug)]
pub struct PropagatedState { pub position:Vec3,pub velocity:Vec3,pub iterations:u32 }

pub fn propagate_kepler(position:Vec3,velocity:Vec3,mu:f64,dt:f64,tolerance:f64,max_iterations:u32)->Result<PropagatedState,String>{
    if !mu.is_finite()||mu<=0.0{return Err("mu must be greater than zero.".into());}
    if !dt.is_finite(){return Err("deltaTimeSeconds must be finite.".into());}
    if !tolerance.is_finite()||tolerance<=0.0{return Err("tolerance must be positive.".into());}
    if max_iterations==0{return Err("maxIterations must be positive.".into());}
    if !position.finite()||!velocity.finite(){return Err("Position and velocity must be finite.".into());}
    let r0=position.norm();if r0==0.0{return Err("Initial position cannot be the primary centre.".into());}
    if dt==0.0{return Ok(PropagatedState{position,velocity,iterations:0});}
    let sqrt_mu=mu.sqrt();
    let vr0=position.dot(velocity)/r0;
    let alpha=2.0/r0-velocity.norm2()/mu;
    let da=alpha*r0;
    let mut chi=if da.abs()>1e-8{sqrt_mu*alpha.abs()*dt}else{sqrt_mu*dt/r0};
    if da < -1e-8 {
        let sign=dt.signum();
        let den=vr0+sign*(-mu/alpha).sqrt()*(1.0-r0*alpha);
        let arg=(-2.0*mu*alpha*dt)/den;
        if arg>0.0&&arg.is_finite(){chi=sign*(-1.0/alpha).sqrt()*arg.ln();}
    }
    let mut converged=false;let mut iterations=0;
    for i in 0..max_iterations {
        let z=alpha*chi*chi;let c=stumpff_c(z)?;let s=stumpff_s(z)?;
        let f=(r0*vr0/sqrt_mu)*chi*chi*c+(1.0-alpha*r0)*chi*chi*chi*s+r0*chi-sqrt_mu*dt;
        let df=(r0*vr0/sqrt_mu)*chi*(1.0-z*s)+(1.0-alpha*r0)*chi*chi*c+r0;
        if !f.is_finite()||!df.is_finite()||df==0.0{break;}
        let correction=f/df;chi-=correction;iterations=i+1;
        if correction.abs()<=tolerance*chi.abs().max(1.0){converged=true;break;}
    }
    if !converged{return Err(format!("Kepler universal-variable solver did not converge after {iterations} iterations."));}
    let z=alpha*chi*chi;let c=stumpff_c(z)?;let s=stumpff_s(z)?;
    let f=1.0-chi*chi*c/r0;let g=dt-chi*chi*chi*s/sqrt_mu;
    let next_position=position.scale(f).add(velocity.scale(g));let rn=next_position.norm();
    if rn==0.0||!rn.is_finite(){return Err("Propagation produced an invalid radius.".into());}
    let fdot=(sqrt_mu/(rn*r0))*(alpha*chi*chi*chi*s-chi);
    let gdot=1.0-chi*chi*c/rn;
    Ok(PropagatedState{position:next_position,velocity:position.scale(fdot).add(velocity.scale(gdot)),iterations})
}

#[derive(Clone, Copy, Debug)]
pub struct OrbitalElements {
    pub semi_major_axis:f64,pub eccentricity:f64,pub inclination:f64,
    pub longitude_ascending_node:f64,pub argument_of_periapsis:f64,pub true_anomaly:f64,
    pub specific_energy:f64,pub specific_angular_momentum:f64,
}
pub fn state_to_elements(r:Vec3,v:Vec3,mu:f64)->Result<OrbitalElements,String>{
    if !mu.is_finite()||mu<=0.0{return Err("mu must be positive.".into());}
    let rn=r.norm();if rn==0.0{return Err("Position cannot be zero.".into());}
    let v2=v.norm2();let h=r.cross(v);let hm=h.norm();if hm==0.0{return Err("Radial trajectory has no defined orbital plane.".into());}
    let ev=v.cross(h).scale(1.0/mu).sub(r.scale(1.0/rn));let e=ev.norm();
    let energy=v2/2.0-mu/rn;let scale=(v2/2.0).max(mu/rn).max(f64::MIN_POSITIVE);
    let parabolic=energy.abs()<=1e-12*scale;
    let a=if parabolic{f64::INFINITY}else{-mu/(2.0*energy)};
    let clamp=|x:f64|x.max(-1.0).min(1.0);
    let inclination=clamp(h.z/hm).acos();let n=Vec3::new(-h.y,h.x,0.0);let nm=n.norm();
    let equatorial=nm<1e-12*hm;let circular=e<1e-10;
    let node=if equatorial{0.0}else{n.y.atan2(n.x)};
    let mut peri=0.0;let mut nu;
    if !circular&&!equatorial{peri=clamp(n.dot(ev)/(nm*e)).acos();if ev.z<0.0{peri=2.0*PI-peri;}}
    else if !circular{peri=ev.y.atan2(ev.x);}
    if !circular{nu=clamp(ev.dot(r)/(e*rn)).acos();if r.dot(v)<0.0{nu=2.0*PI-nu;}}
    else if !equatorial{nu=clamp(n.dot(r)/(nm*rn)).acos();if r.z<0.0{nu=2.0*PI-nu;}}
    else{nu=r.y.atan2(r.x);if nu<0.0{nu+=2.0*PI;}}
    Ok(OrbitalElements{semi_major_axis:a,eccentricity:e,inclination,longitude_ascending_node:node,argument_of_periapsis:peri,true_anomaly:nu,specific_energy:energy,specific_angular_momentum:hm})
}

/// Convert semilatus rectum and true anomaly to an inertial state for any conic.
pub fn conic_elements_to_state(p:f64,e:f64,i:f64,node:f64,peri:f64,nu:f64,mu:f64)->Result<(Vec3,Vec3),String>{
 if !p.is_finite()||p<=0.0||!mu.is_finite()||mu<=0.0{return Err("Semilatus rectum and mu must be positive.".into())}
 if !e.is_finite()||e<0.0{return Err("Eccentricity must be finite and non-negative.".into())}
 if ![i,node,peri,nu].iter().all(|x|x.is_finite()){return Err("Orbital angles must be finite.".into())}
 let denominator=1.0+e*nu.cos();
 if !denominator.is_finite()||denominator<=1e-14{return Err("True anomaly is outside the physical branch of this conic.".into())}
 let radius=p/denominator;if !radius.is_finite()||radius<=0.0{return Err("Conic radius is not finite and positive.".into())}
 let x=radius*nu.cos();let y=radius*nu.sin();let speed=(mu/p).sqrt();let vx=-speed*nu.sin();let vy=speed*(e+nu.cos());
 let(c_o,s_o)=(node.cos(),node.sin());let(c_i,s_i)=(i.cos(),i.sin());let(c_w,s_w)=(peri.cos(),peri.sin());
 let m11=c_o*c_w-s_o*s_w*c_i;let m12=-c_o*s_w-s_o*c_w*c_i;let m21=s_o*c_w+c_o*s_w*c_i;let m22=-s_o*s_w+c_o*c_w*c_i;let m31=s_w*s_i;let m32=c_w*s_i;
 Ok((Vec3::new(m11*x+m12*y,m21*x+m22*y,m31*x+m32*y),Vec3::new(m11*vx+m12*vy,m21*vx+m22*vy,m31*vx+m32*vy)))
}

pub fn orbital_elements_to_state(a:f64,e:f64,i:f64,node:f64,peri:f64,mean:f64,mu:f64)->Result<(Vec3,Vec3),String>{
    if !a.is_finite()||a<=0.0||!mu.is_finite()||mu<=0.0{return Err("Semi-major axis and mu must be positive.".into());}
    if !e.is_finite()||!(0.0..1.0).contains(&e){return Err("Elliptic eccentricity must be in [0, 1).".into());}
    if ![i,node,peri,mean].iter().all(|x|x.is_finite()){return Err("Orbital angles must be finite.".into());}
    let tau=2.0*PI;let m=mean.rem_euclid(tau);let mut ecc=if e<0.8{m}else{PI};
    let mut converged=false;
    for _ in 0..50{let f=ecc-e*ecc.sin()-m;let df=1.0-e*ecc.cos();let delta=f/df;ecc-=delta;if delta.abs()<=1e-13{converged=true;break;}}
    if !converged{return Err("Kepler equation solver did not converge.".into());}
    let ce=ecc.cos();let se=ecc.sin();let root=(1.0-e*e).sqrt();let n=(mu/(a*a*a)).sqrt();
    let x=a*(ce-e);let y=a*root*se;let den=1.0-e*ce;
    let vx=-a*n*se/den;let vy=a*n*root*ce/den;
    let (c_o,s_o)=(node.cos(),node.sin());let (c_i,s_i)=(i.cos(),i.sin());let(c_w,s_w)=(peri.cos(),peri.sin());
    let m11=c_o*c_w-s_o*s_w*c_i;let m12=-c_o*s_w-s_o*c_w*c_i;
    let m21=s_o*c_w+c_o*s_w*c_i;let m22=-s_o*s_w+c_o*c_w*c_i;
    let m31=s_w*s_i;let m32=c_w*s_i;
    Ok((Vec3::new(m11*x+m12*y,m21*x+m22*y,m31*x+m32*y),Vec3::new(m11*vx+m12*vy,m21*vx+m22*vy,m31*vx+m32*vy)))
}


#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn conic_conversion_supports_all_three_trajectory_types(){
  let mu=3.986004418e14;let p=7.0e6;
  for e in [0.4,1.0,1.4]{
   let(r,v)=conic_elements_to_state(p,e,0.3,0.4,0.5,0.6,mu).unwrap();
   let elements=state_to_elements(r,v,mu).unwrap();
   assert!((elements.eccentricity-e).abs()<1e-10);
  }
 }
 #[test]
 fn circular_kepler_orbit_closes_after_one_period() {
  let mu:f64=3.986004418e14;let radius:f64=7_000_000.0;let speed=(mu/radius).sqrt();
  let period=2.0*std::f64::consts::PI*(radius.powi(3)/mu).sqrt();
  let state=propagate_kepler(Vec3::new(radius,0.0,0.0),Vec3::new(0.0,speed,0.0),mu,period,1e-10,100).unwrap();
  assert!((state.position.x-radius).abs()/radius<1e-8);assert!(state.position.y.abs()/radius<1e-8);assert!((state.velocity.y-speed).abs()/speed<1e-8);
 }
 #[test]
 fn universal_propagation_is_reversible() {
  let r=Vec3::new(7.0e6,1.0e5,-2.0e5);let v=Vec3::new(-100.0,7500.0,40.0);let mu=3.986004418e14;
  let forward=propagate_kepler(r,v,mu,1234.0,1e-11,100).unwrap();
  let back=propagate_kepler(forward.position,forward.velocity,mu,-1234.0,1e-11,100).unwrap();
  assert!(back.position.sub(r).norm()<1e-3);assert!(back.velocity.sub(v).norm()<1e-6);
 }
}


#[cfg(test)]
mod force_tests{
 use super::*;
 #[test]
 fn point_mass_acceleration_is_inverse_square_and_inward(){
  let mu=3.986004418e14;let p=Vec3::new(7.0e6,0.0,0.0);
  let a=p.scale(-mu/p.norm().powi(3));
  assert!(a.x<0.0);assert_eq!(a.y,0.0);assert!((a.x+mu/(7.0e6_f64.powi(2))).abs()<1e-12);
 }
 #[test]
 fn circular_orbit_specific_energy_is_negative(){
  let mu:f64=3.986004418e14;let radius:f64=7.0e6;let speed=(mu/radius).sqrt();
  let energy=0.5*speed*speed-mu/radius;
  assert!((energy+mu/(2.0*radius)).abs()<1e-8);
 }
}
