use crate::physics::Vec3;

pub type Triangle=[Vec3;3];
#[derive(Clone,Debug)]
pub struct Tile { pub face:u32,pub path:String,pub level:u32,pub triangle:Triangle }
const PHI:f64=1.618033988749895;
const FACES:[[usize;3];20]=[
[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
fn normalize(v:Vec3)->Result<Vec3,String>{v.normalized()}
fn midpoint(a:Vec3,b:Vec3)->Result<Vec3,String>{normalize(a.add(b).scale(0.5))}
fn vertices()->Result<[Vec3;12],String>{
 let raw=[(-1.0,PHI,0.0),(1.0,PHI,0.0),(-1.0,-PHI,0.0),(1.0,-PHI,0.0),(0.0,-1.0,PHI),(0.0,1.0,PHI),(0.0,-1.0,-PHI),(0.0,1.0,-PHI),(PHI,0.0,-1.0),(PHI,0.0,1.0),(-PHI,0.0,-1.0),(-PHI,0.0,1.0)];
 let mut out=[Vec3::new(0.0,0.0,0.0);12];for(i,(x,y,z))in raw.iter().enumerate(){out[i]=normalize(Vec3::new(*x,*y,*z))?;}Ok(out)
}
pub fn base_tile(face:u32)->Result<Tile,String>{
 if face>=20{return Err("Geodesic face must be in [0, 19].".into());}
 let v=vertices()?;let f=FACES[face as usize];
 Ok(Tile{face,path:String::new(),level:0,triangle:[v[f[0]],v[f[1]],v[f[2]]]})
}
pub fn subdivide(t:Triangle)->Result<[Triangle;4],String>{
 let ab=midpoint(t[0],t[1])?;let bc=midpoint(t[1],t[2])?;let ca=midpoint(t[2],t[0])?;
 Ok([[t[0],ab,ca],[ab,t[1],bc],[ca,bc,t[2]],[ab,bc,ca]])
}
pub fn resolve_tile(face:u32,path:&str)->Result<Tile,String>{
 if face>=20||!path.chars().all(|c|matches!(c,'0'|'1'|'2'|'3')){return Err("Invalid geodesic tile identifier.".into());}
 let mut tile=base_tile(face)?;
 for digit in path.chars(){let children=subdivide(tile.triangle)?;tile.triangle=children[digit.to_digit(10).unwrap() as usize];tile.path.push(digit);tile.level+=1;}
 Ok(tile)
}
pub fn barycentric_direction(t:Triangle,u:f64,v:f64)->Result<Vec3,String>{
 normalize(t[0].scale(1.0-u-v).add(t[1].scale(u)).add(t[2].scale(v)))
}
pub struct TileMesh {pub directions:Vec<f32>,pub positions:Vec<f32>,pub normals:Vec<f32>,pub uv:Vec<f32>,pub indices:Vec<u32>}
pub fn build_tile_mesh(tile:&Tile,resolution:u32,radius:f64)->Result<TileMesh,String>{
 if resolution<2||resolution%2!=0||resolution>64{return Err("Geodesic mesh resolution must be an even integer in [2, 64].".into());}
 if !radius.is_finite()||radius<=0.0{return Err("Geodesic mesh radius must be positive metres.".into());}
 let count=((resolution+1)*(resolution+2)/2) as usize;
 let mut directions=Vec::with_capacity(count*3);let mut positions=Vec::with_capacity(count*3);let mut normals=Vec::with_capacity(count*3);let mut uv=Vec::with_capacity(count*2);
 for row in 0..=resolution{for col in 0..=resolution-row{
  let u=col as f64/resolution as f64;let v=row as f64/resolution as f64;let d=barycentric_direction(tile.triangle,u,v)?;
  directions.extend([d.x as f32,d.y as f32,d.z as f32]);normals.extend([d.x as f32,d.y as f32,d.z as f32]);
  let q=u+v;let tu=q*q;let tv=if q>1e-12{v/q}else{0.5};uv.extend([tu as f32,tv as f32]);
  positions.extend([(d.x*radius) as f32,(d.y*radius) as f32,(d.z*radius) as f32]);
 }}
 let idx=|row:u32,col:u32|->u32{row*(resolution+1)-row*row.saturating_sub(1)/2+col};
 let mut indices=Vec::with_capacity((resolution*resolution*3) as usize);
 for row in 0..resolution{for col in 0..resolution-row{
  let a=idx(row,col);let b=idx(row,col+1);let c=idx(row+1,col);
  indices.extend([a,b,c]);if row+col<resolution-1{let d=idx(row+1,col+1);indices.extend([b,d,c]);}
 }}
 Ok(TileMesh{directions,positions,normals,uv,indices})
}


#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn icosahedron_has_twenty_root_faces_and_children() {
  let mut roots=Vec::new();for face in 0..20{roots.push(base_tile(face).unwrap());}
  assert_eq!(roots.len(),20);assert_eq!(subdivide(roots[0].triangle).unwrap().len(),4);
 }
 #[test]
 fn tile_mesh_has_expected_triangular_topology() {
  let tile=resolve_tile(3,"012").unwrap();let mesh=build_tile_mesh(&tile,16,6_371_000.0).unwrap();
  assert_eq!(mesh.directions.len()/3,153);assert_eq!(mesh.indices.len(),16*16*3);assert!(mesh.positions.iter().all(|v|v.is_finite()));
 }
}


/// Generates a conforming triangular-grid index buffer for coarse-neighbor edges.
/// Edge bits: AB=row 0, BC=row+column=resolution, CA=column 0.
pub fn build_stitch_indices(resolution:u32,mask:u32)->Result<Vec<u32>,String>{
 use std::collections::HashMap;
 type Point=(i32,i32);
 type Tri=[Point;3];
 fn orient(a:Point,b:Point,p:Point)->i64{
  ((b.1-a.1) as i64)*((p.0-a.0) as i64)-((b.0-a.0) as i64)*((p.1-a.1) as i64)
 }
 fn key(p:Point)->String{format!("{}:{}",p.0,p.1)}
 fn edge_key(a:Point,b:Point)->String{let ka=key(a);let kb=key(b);if ka<kb{format!("{}|{}",ka,kb)}else{format!("{}|{}",kb,ka)}}
 fn vertex_index(resolution:u32,row:u32,column:u32)->u32{
  row*(resolution+1)-row*(row.saturating_sub(1))/2+column
 }
 if resolution<2||resolution%2!=0||resolution>64{return Err("Stitching resolution must be an even integer in [2, 64].".into());}
 if mask>7{return Err("Stitch edge mask must be in [0, 7].".into());}
 if mask==0{
  let mut indices=Vec::with_capacity((resolution*resolution*3) as usize);
  for row in 0..resolution{for column in 0..resolution-row{
   let a=vertex_index(resolution,row,column);let b=vertex_index(resolution,row,column+1);let c=vertex_index(resolution,row+1,column);
   indices.extend([a,b,c]);
   if row+column<resolution-1{let d=vertex_index(resolution,row+1,column+1);indices.extend([b,d,c]);}
  }}
  return Ok(indices);
 }
 let r=resolution as i32;
 let mut triangles:Vec<Tri>=vec![[(0,0),(0,r),(r,0)]];
 for row in 0..=r{for column in 0..=r-row{
  let removed=((mask&1)!=0&&row==0&&column%2==1)
   ||((mask&2)!=0&&row+column==r&&row%2==1)
   ||((mask&4)!=0&&column==0&&row%2==1);
  if removed||((row==0&&column==0)||(row==0&&column==r)||(row==r&&column==0)){continue;}
  let point=(row,column);
  let mut containing:Vec<Tri>=Vec::new();
  for tri in &triangles{
   if orient(tri[0],tri[1],point)>=0&&orient(tri[1],tri[2],point)>=0&&orient(tri[2],tri[0],point)>=0{containing.push(*tri);}
  }
  if containing.is_empty(){return Err("Stitch triangulation could not locate an interior grid point.".into());}
  let mut boundary:HashMap<String,(Point,Point,u32)>=HashMap::new();
  for tri in &containing{for edge in 0..3{
   let from=tri[edge];let to=tri[(edge+1)%3];let k=edge_key(from,to);
   boundary.entry(k).and_modify(|value|value.2+=1).or_insert((from,to,1));
  }}
  triangles.retain(|tri|!containing.contains(tri));
  for (_, (from,to,count)) in boundary{if count!=1{continue;}let winding=orient(from,to,point);
   if winding>0{triangles.push([from,to,point]);}else if winding<0{triangles.push([to,from,point]);}
  }
 }}
 let mut indices=Vec::with_capacity(triangles.len()*3);
 for tri in triangles{
  if orient(tri[0],tri[1],tri[2])<=0{return Err("Stitch triangulation produced invalid winding.".into());}
  for point in tri{indices.push(vertex_index(resolution,point.0 as u32,point.1 as u32));}
 }
 Ok(indices)
}

#[cfg(test)]
mod stitching_tests{
 use super::*;
 #[test]
 fn all_stitch_masks_produce_valid_triangles(){
  for resolution in [8,16,32,48,64]{for mask in 0..8{
   let indices=build_stitch_indices(resolution,mask).unwrap();
   assert!(!indices.is_empty());assert_eq!(indices.len()%3,0);
   let vertex_count=(resolution+1)*(resolution+2)/2;
   assert!(indices.iter().all(|index|*index<vertex_count));
  }}
 }
 #[test]
 fn zero_mask_matches_regular_grid_topology(){
  for resolution in [8,16,32,64]{
   let indices=build_stitch_indices(resolution,0).unwrap();
   assert_eq!(indices.len(),(resolution*resolution*3) as usize);
  }
 }
}
