use crate::geometry::{barycentric_direction,resolve_tile};
use crate::physics::Vec3;
use serde::Deserialize;

#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct SurfaceProfile{
 pub body_id:String,pub seed:u64,pub kind:String,pub mass_kg:f64,pub mean_radius_m:f64,pub gravity_m_s2:f64,
 pub temperature_k:f64,pub pressure_pa:f64,pub water_fraction:f64,pub ice_fraction:f64,pub iron_fraction:f64,
 pub silicate_fraction:f64,pub volatile_fraction:f64,pub sulfur_fraction:f64,pub tectonic_activity:f64,
 pub volcanic_activity:f64,pub erosion:f64,pub age:f64,
}
#[derive(Clone,Copy)]
struct Plate{direction:Vec3,elevation:f64}
#[derive(Clone,Copy)]
struct Sample{color:[f64;3],height:f64,rough:f64,material:u8}
pub struct TileOutput{pub albedo:Vec<u8>,pub normal:Vec<u8>,pub height:Vec<f32>,pub roughness:Vec<u8>,pub material:Vec<u8>}
fn clamp(x:f64,a:f64,b:f64)->f64{x.max(a).min(b)}
fn smooth(a:f64,b:f64,x:f64)->f64{let t=clamp((x-a)/(b-a),0.0,1.0);t*t*(3.0-2.0*t)}
fn normalize(v:Vec3)->Vec3{v.normalized().unwrap_or(Vec3::new(0.0,1.0,0.0))}
fn hash(x:i32,y:i32,z:i32,seed:u32)->f64{
 let mut h=x.wrapping_mul(374761393).wrapping_add(y.wrapping_mul(668265263)).wrapping_add(z.wrapping_mul(2147483647)).wrapping_add((seed as i32).wrapping_mul(1274126177));
 h=((h as u32)^((h as u32)>>13)) as i32;h=h.wrapping_mul(1274126177);h=((h as u32)^((h as u32)>>16)) as i32;(h as u32) as f64/4294967295.0
}
fn value_noise(p:Vec3,seed:u32)->f64{
 let(ix,iy,iz)=(p.x.floor() as i32,p.y.floor() as i32,p.z.floor() as i32);let(fx,fy,fz)=(p.x-ix as f64,p.y-iy as f64,p.z-iz as f64);
 let(sx,sy,sz)=(fx*fx*(3.0-2.0*fx),fy*fy*(3.0-2.0*fy),fz*fz*(3.0-2.0*fz));
 let(a,b,c,d)=(hash(ix,iy,iz,seed),hash(ix+1,iy,iz,seed),hash(ix,iy+1,iz,seed),hash(ix+1,iy+1,iz,seed));
 let(e,f,g,h)=(hash(ix,iy,iz+1,seed),hash(ix+1,iy,iz+1,seed),hash(ix,iy+1,iz+1,seed),hash(ix+1,iy+1,iz+1,seed));
 let low=(a+(b-a)*sx)+((c+(d-c)*sx)-(a+(b-a)*sx))*sy;
 let high=(e+(f-e)*sx)+((g+(h-g)*sx)-(e+(f-e)*sx))*sy;low+(high-low)*sz
}
fn fbm(p:Vec3,seed:u32,octaves:u32)->f64{
 let(mut sum,mut amp,mut norm)=(0.0,0.5,0.0);let mut q=p;
 for i in 0..octaves{sum+=value_noise(q,seed.wrapping_add(i*101))*amp;norm+=amp;q=Vec3::new(q.x*2.03+17.1,q.y*2.03+9.2,q.z*2.03+13.7);amp*=0.5;}sum/norm
}
fn plates(seed:u32,p:&SurfaceProfile)->Vec<Plate>{
 let count=10+(p.tectonic_activity*10.0).round() as u32;let mut out=Vec::new();
 for i in 0..count{let y=1.0-2.0*(i as f64+0.5)/count as f64;let angle=i as f64*2.399963229728653+hash(i as i32,3,7,seed)*0.7;let r=(1.0-y*y).sqrt();
 out.push(Plate{direction:Vec3::new(angle.cos()*r,y,angle.sin()*r),elevation:(hash(i as i32,19,13,seed)-0.5)*0.12});}out
}
fn geology(d:Vec3,p:&SurfaceProfile,plate_set:&[Plate],lod_level:u32)->Sample{
 let seed=p.seed as u32;let macro_n=fbm(d.scale(3.1),seed,5);let regional=fbm(d.scale(11.0),seed.wrapping_add(31),4);
 let mut nearest=2.0;let mut second=2.0;let mut first=None;
 for plate in plate_set{let q=1.0-d.dot(plate.direction);if q<nearest{second=nearest;nearest=q;first=Some(*plate);}else if q<second{second=q;}}
 let boundary=1.0-smooth(0.006,0.055,second-nearest);let plate=first.unwrap_or(Plate{direction:d,elevation:0.0});
 let tectonic=boundary*p.tectonic_activity;let volcanic=fbm(d.scale(19.0),seed.wrapping_add(71),4)*p.volcanic_activity;
 let latitude=d.y.abs();let frost=smooth(0.68,0.96,latitude)*p.ice_fraction;let detail=fbm(d.scale(47.0),seed.wrapping_add(97),3);
 // Мікродеталі додаються поступово з підвищенням геодезичного рівня деталізації.
 let micro=fbm(d.scale(24.0),seed.wrapping_add(401),lod_level.saturating_add(1).clamp(1,6));
 let mut height:f64;let mut color:[f64;3];let mut rough:f64;let mut material:u8;
 if p.kind=="oceanic"||p.water_fraction>0.45{
  let continental=smooth(-0.08,0.13,macro_n-0.48+plate.elevation+tectonic*0.09);let trench=boundary*boundary*p.tectonic_activity*0.11;let mountains=boundary.powf(0.7)*p.tectonic_activity*0.16;
  height=(macro_n-0.5)*0.18+(regional-0.5)*0.065+mountains-trench+volcanic*0.035;
  let land=[0.12+detail*0.12,0.22+detail*0.14,0.075+detail*0.05];let ocean=[0.006+regional*0.012,0.035+regional*0.035,0.12+regional*0.075];
  color=[0,1,2].map(|i|ocean[i]+(land[i]-ocean[i])*continental);rough=0.12+continental*0.76;material=if continental>0.5{2}else{3};
 }else if p.kind=="icy"||p.kind=="ice-giant"{
  let fracture=1.0-(fbm(d.scale(24.0),seed.wrapping_add(151),4)-0.5).abs()*2.0;height=(macro_n-0.5)*0.09+fracture*0.035+boundary*p.tectonic_activity*0.035;
  color=[0.38+detail*0.2,0.58+detail*0.22,0.68+detail*0.25];rough=0.28;material=4;
 }else if p.kind=="volcanic"{
  let lava=smooth(0.62,0.86,fbm(d.scale(13.0),seed.wrapping_add(181),5)+volcanic*0.4);height=(macro_n-0.5)*0.08+volcanic*0.16+boundary*0.035;
  color=[0.13+lava*0.55,0.09+lava*0.19,0.055+lava*0.04];rough=0.58;material=5;
 }else{
  let mountains=(1.0-(fbm(d.scale(8.0),seed.wrapping_add(211),5)-0.5).abs()*2.0).powi(2);
  let crater=1.0-smooth(0.18,0.42,fbm(d.scale(9.0),seed.wrapping_add(223),4));height=(macro_n-0.5)*0.13+mountains*p.tectonic_activity*0.16-crater*p.age*0.075+volcanic*0.035;
  let oxide=clamp(p.iron_fraction*0.75+detail*0.2,0.0,1.0);color=[0.22+oxide*0.35+regional*0.08,0.19+oxide*0.12+detail*0.05,0.16+detail*0.04];rough=0.82;material=1;
 }
 if p.kind=="desert"{let dune=fbm(Vec3::new(d.x*55.0,d.y*13.0,d.z*55.0),seed.wrapping_add(241),3);height+=(dune-0.5)*0.055;color=[0.48+dune*0.2,0.27+dune*0.13,0.12+dune*0.07];rough=0.94;}
 if p.kind!="gas-giant"&&p.kind!="ice-giant"&&frost>0.08{color=[color[0]+(0.84-color[0])*frost,color[1]+(0.9-color[1])*frost,color[2]+(0.96-color[2])*frost];height*=1.0-frost*0.3;rough=rough*(1.0-frost)+0.32*frost;material=4;}
 height*=clamp(1.0-p.erosion*0.55,0.2,1.2)*clamp((9.81/p.gravity_m_s2.max(0.15)).sqrt(),0.45,1.7);
 height+=(micro-0.5)*0.003;
 let micro_tone=(micro-0.5)*0.055;
 color=color.map(|value|clamp(value*(1.0+micro_tone),0.0,1.0));
 rough=clamp(rough+(micro-0.5)*0.045,0.0,1.0);
 height+=(detail-0.5)*0.006;
 Sample{color,height,rough,material}
}
fn height_limits(p:&SurfaceProfile)->(f64,f64){
 match p.body_id.to_lowercase().as_str(){
  "earth"=>(11000.0,9000.0),"mars"=>(22000.0,22000.0),"moon"=>(11000.0,11000.0),
  "mercury"=>(10000.0,10000.0),"venus"=>(12000.0,12000.0),"io"=>(17000.0,17000.0),
  "europa"=>(3000.0,3000.0),"ganymede"=>(10000.0,10000.0),"callisto"=>(10000.0,10000.0),
  "titan"=>(5000.0,5000.0),"triton"=>(2000.0,2000.0),"phobos"=>(5000.0,5000.0),"deimos"=>(3000.0,3000.0),
  _=>{let generic=(p.mean_radius_m*0.003).max(10.0).min(50000.0);(generic,generic)}
 }
}
fn atmosphere(d:Vec3,p:&SurfaceProfile)->Sample{
 let latitude=d.y;let seed=p.seed as u32;let flow=fbm(Vec3::new(d.x*5.0,d.y*17.0,d.z*5.0),seed.wrapping_add(301),5);
 let cloud=fbm(Vec3::new(d.x*19.0,d.y*39.0,d.z*19.0),seed.wrapping_add(331),4);
 let vortex=fbm(Vec3::new(d.x*8.0+flow,d.y*5.0,d.z*8.0-flow),seed.wrapping_add(367),5);
 let jet=((latitude*(if p.kind=="gas-giant"{38.0}else{25.0})+flow*0.13)*std::f64::consts::TAU).sin();
 let bands=smooth(-0.4,0.55,jet+(flow-0.5)*0.8);let storm=smooth(0.67,0.9,cloud+vortex*0.18);
 let color=match p.body_id.as_str(){
  "saturn"=>[0.48+bands*0.22+storm*0.08,0.36+bands*0.18+storm*0.04,0.22+bands*0.12],
  "jupiter"=>[0.28+bands*0.42+storm*0.22,0.16+bands*0.28+storm*0.08,0.09+bands*0.17],
  "uranus"=>[0.12+bands*0.08+cloud*0.08,0.36+bands*0.2+cloud*0.08,0.48+bands*0.24+cloud*0.1],
  _=>[0.045+bands*0.1+storm*0.12,0.12+bands*0.18+storm*0.14,0.32+bands*0.3+storm*0.2]
 };
 let rough=match p.body_id.as_str(){"saturn"=>0.76,"jupiter"=>0.72,"uranus"=>0.7,_=>0.68};
 Sample{color,height:0.0,rough,material:10}
}
fn sample(d:Vec3,p:&SurfaceProfile,plate_set:&[Plate],lod_level:u32)->Sample{
 if p.kind=="gas-giant"||p.kind=="ice-giant"{atmosphere(d,p)}else{geology(d,p,plate_set,lod_level)}
}
fn set_u8(dst:&mut Vec<u8>,values:&[f64]){for v in values{dst.push((clamp(*v,0.0,1.0)*255.0).round() as u8);}}
pub fn generate_tile(face:u32,path:&str,resolution:u32,gutter:u32,p:&SurfaceProfile)->Result<TileOutput,String>{
 if resolution<8||resolution>1024{return Err("Surface tile resolution must be in [8, 1024].".into());}
 if gutter>16{return Err("Surface tile gutter must be in [0, 16].".into());}
 if !p.mean_radius_m.is_finite()||p.mean_radius_m<=0.0||!p.gravity_m_s2.is_finite()||p.gravity_m_s2<=0.0{return Err("Surface profile radius and gravity must be positive.".into());}
 let tile=resolve_tile(face,path)?;let width=resolution+2*gutter;let count=(width*width) as usize;
 let mut out=TileOutput{albedo:Vec::with_capacity(count*4),normal:Vec::with_capacity(count*3),height:Vec::with_capacity(count),roughness:Vec::with_capacity(count),material:Vec::with_capacity(count)};
 let plate_set=if p.kind=="gas-giant"||p.kind=="ice-giant"{Vec::new()}else{plates(p.seed as u32,p)};
 let(negative_limit,positive_limit)=height_limits(p);
 // Процедурна висота масштабується до фізичного діапазону конкретного небесного тіла.
 let height_fraction=|v:f64|clamp(v*(if v<0.0{negative_limit}else{positive_limit})/p.mean_radius_m,-negative_limit/p.mean_radius_m,positive_limit/p.mean_radius_m);
 let mut directions=Vec::with_capacity(count);
 let mut displaced_positions=Vec::with_capacity(count);
 let mut samples=Vec::with_capacity(count);

 // Перший прохід: один дорогий геологічний семпл на texel.
 for row in -(gutter as i32)..(resolution as i32+gutter as i32){for col in -(gutter as i32)..(resolution as i32+gutter as i32){
  let px=(col as f64+0.5)/resolution as f64;let py=(row as f64+0.5)/resolution as f64;
  let q=px.signum()*px.abs().sqrt();let u=q*(1.0-py);let v=q*py;
  let d=barycentric_direction(tile.triangle,u,v)?;let s=sample(d,p,&plate_set,tile.level);
  let height_m=height_fraction(s.height)*p.mean_radius_m;
  let radius_scale=1.0+height_m/p.mean_radius_m;
  directions.push(d);
  displaced_positions.push(d.scale(radius_scale));
  samples.push(s);
  out.height.push(height_m as f32);
 }}

 // Другий прохід: нормаль із похідних готової зміщеної геометрії.
 // Не повторюємо fbm/пошук тектонічних плит чотири рази для кожного texel.
 let width=width as usize;
 for row in 0..width{for col in 0..width{
  let left=row*width+col.saturating_sub(1);
  let right=row*width+(col+1).min(width-1);
  let up=row.saturating_sub(1)*width+col;
  let down=(row+1).min(width-1)*width+col;
  let dx=displaced_positions[right].sub(displaced_positions[left]);
  let dy=displaced_positions[down].sub(displaced_positions[up]);
  let direction=directions[row*width+col];
  let mut normal=dx.cross(dy);
  if normal.dot(direction)<0.0{normal=normal.scale(-1.0);}
  normal=if normal.norm2()<1e-24{direction}else{normalize(normal)};
  let s=samples[row*width+col];
  set_u8(&mut out.albedo,&[s.color[0],s.color[1],s.color[2],1.0]);
  set_u8(&mut out.normal,&[normal.x*0.5+0.5,normal.y*0.5+0.5,normal.z*0.5+0.5]);
  out.roughness.push((clamp(s.rough,0.0,1.0)*255.0).round() as u8);
  out.material.push(s.material);
 }}
 Ok(out)
}


#[cfg(test)]
mod tests {
 use super::*;
 fn earth()->SurfaceProfile{SurfaceProfile{body_id:"earth".into(),seed:123456,kind:"oceanic".into(),mass_kg:5.9722e24,mean_radius_m:6_371_000.0,gravity_m_s2:9.81,temperature_k:288.0,pressure_pa:101325.0,water_fraction:0.71,ice_fraction:0.025,iron_fraction:0.32,silicate_fraction:0.62,volatile_fraction:0.03,sulfur_fraction:0.01,tectonic_activity:0.8,volcanic_activity:0.32,erosion:0.78,age:0.18}}
 #[test]
 fn generated_channels_have_expected_sizes_and_are_deterministic(){
  let p=earth();let a=generate_tile(0,"",8,2,&p).unwrap();let b=generate_tile(0,"",8,2,&p).unwrap();let count=12*12;
  assert_eq!(a.albedo.len(),count*4);assert_eq!(a.normal.len(),count*3);assert_eq!(a.height.len(),count);assert_eq!(a.roughness.len(),count);assert_eq!(a.material.len(),count);
  assert_eq!(a.albedo,b.albedo);assert_eq!(a.normal,b.normal);assert_eq!(a.height,b.height);
  assert!(a.height.iter().all(|v|v.is_finite()&&*v>=-11000.0&&*v<=9000.0));
 }

 #[test]
 fn normals_are_finite_unit_vectors_from_the_displaced_height_field(){
  let output=generate_tile(0,"1",24,2,&earth()).unwrap();
  assert_eq!(output.normal.len(),output.height.len()*3);
  for normal in output.normal.chunks_exact(3){
   let x=normal[0] as f64/127.5-1.0;
   let y=normal[1] as f64/127.5-1.0;
   let z=normal[2] as f64/127.5-1.0;
   let length=(x*x+y*y+z*z).sqrt();
   assert!(length.is_finite()&&(length-1.0).abs()<0.025);
  }
  assert!(output.height.iter().any(|height|height.abs()>1.0));
 }
}
