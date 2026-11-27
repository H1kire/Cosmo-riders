import { barycentricDirection, resolveGeoTile, type GeoTileId, type Vec3 } from './icosphere.ts';

export type SurfaceKind='rocky'|'oceanic'|'desert'|'icy'|'volcanic'|'gas-giant'|'ice-giant'|'unknown';
export interface SurfaceProfile {
 readonly bodyId:string; readonly seed:number; readonly kind:SurfaceKind;
 readonly massKg:number; readonly meanRadiusM:number; readonly gravityMS2:number;
 readonly temperatureK:number; readonly pressurePa:number; readonly waterFraction:number;
 readonly iceFraction:number; readonly ironFraction:number; readonly silicateFraction:number;
 readonly volatileFraction:number; readonly sulfurFraction:number;
 readonly tectonicActivity:number; readonly volcanicActivity:number; readonly erosion:number;
 readonly age:number; readonly rotationPeriodSeconds:number|null;
 readonly algorithmVersion:number;
}
export interface SurfaceTileRequest { readonly planetId:string; readonly seed:number; readonly tile:GeoTileId; readonly resolution:number; readonly gutter?:number; readonly profile:SurfaceProfile; }
export interface SurfaceTileData {
 readonly key:string; readonly resolution:number; readonly gutter:number;
 readonly albedo:Uint8Array; readonly normal:Uint8Array; readonly height:Float32Array;
 readonly roughness:Uint8Array; readonly materialId:Uint8Array; readonly generationMs:number;
}
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
const signedSqrt=(x:number)=>Math.sign(x)*Math.sqrt(Math.abs(x));

/** Відображає квадратну сторінку на трикутник без обрізання великої частини текстури. */
export function squareToTriangleBarycentric(x:number,y:number):readonly [number,number]{
 const q=signedSqrt(x);
 return [q*(1-y),q*y];
}

/** Обернене відображення барицентричної точки всередині трикутника у UV сторінки. */
export function triangleToSquareUv(u:number,v:number):readonly [number,number]{
 const q=u+v;
 return [q*q,q>1e-12?v/q:.5];
}
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
function hash(x:number,y:number,z:number,seed:number):number{
 let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(z|0,2147483647)+Math.imul(seed|0,1274126177))|0;
 h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return(h>>>0)/4294967295;
}
function valueNoise(p:Vec3,seed:number):number{
 const ix=Math.floor(p[0]),iy=Math.floor(p[1]),iz=Math.floor(p[2]);
 const fx=p[0]-ix,fy=p[1]-iy,fz=p[2]-iz;
 const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),sz=fz*fz*(3-2*fz);
 const a=hash(ix,iy,iz,seed),b=hash(ix+1,iy,iz,seed),c=hash(ix,iy+1,iz,seed),d=hash(ix+1,iy+1,iz,seed);
 const e=hash(ix,iy,iz+1,seed),f=hash(ix+1,iy,iz+1,seed),g=hash(ix,iy+1,iz+1,seed),h=hash(ix+1,iy+1,iz+1,seed);
 const low=(a+(b-a)*sx)+((c+(d-c)*sx)-(a+(b-a)*sx))*sy;
 const high=(e+(f-e)*sx)+((g+(h-g)*sx)-(e+(f-e)*sx))*sy;
 return low+(high-low)*sz;
}
function fbm(p:Vec3,seed:number,octaves:number):number{
 let sum=0,amp=.5,norm=0,q:[number,number,number]=[...p];
 for(let i=0;i<octaves;i++){sum+=valueNoise(q,seed+i*101)*amp;norm+=amp;q=[q[0]*2.03+17.1,q[1]*2.03+9.2,q[2]*2.03+13.7];amp*=.5;}
 return sum/norm;
}
interface Plate { direction:Vec3; oceanic:boolean; elevation:number; }
function plates(seed:number,profile:SurfaceProfile):Plate[]{
 const count=10+Math.round(profile.tectonicActivity*10),out:Plate[]=[];
 for(let i=0;i<count;i++){
  const y=1-2*(i+.5)/count,angle=i*2.399963229728653+hash(i,3,7,seed)*.7,r=Math.sqrt(1-y*y);
  out.push({direction:[Math.cos(angle)*r,y,Math.sin(angle)*r],oceanic:hash(i,11,5,seed)<clamp(.55-profile.silicateFraction*.2),elevation:(hash(i,19,13,seed)-.5)*.12});
 }
 return out;
}
function geologicalSample(d:Vec3,p:SurfaceProfile,plateSet:Plate[],lodLevel:number):{color:[number,number,number];height:number;rough:number;material:number}{
 const seed=p.seed,macro=fbm([d[0]*3.1,d[1]*3.1,d[2]*3.1],seed,5),regional=fbm([d[0]*11,d[1]*11,d[2]*11],seed+31,4);
 let nearest=2,second=2,first:Plate|undefined;
 for(const plate of plateSet){const q=1-(d[0]*plate.direction[0]+d[1]*plate.direction[1]+d[2]*plate.direction[2]);if(q<nearest){second=nearest;nearest=q;first=plate;}else if(q<second)second=q;}
 const boundary=1-smooth(.006,.055,second-nearest),plate=first!;
 const tectonic=boundary*p.tectonicActivity,volcanic=fbm([d[0]*19,d[1]*19,d[2]*19],seed+71,4)*p.volcanicActivity;
 const latitude=Math.abs(d[1]);
 const coldRetention=1-smooth(235,360,p.temperatureK);
 const volatileRetention=1-smooth(150,320,p.temperatureK)*(1-clamp(p.volatileFraction));
 const frost=clamp(smooth(.68,.96,latitude)*(p.iceFraction*(.28+.72*coldRetention)+p.waterFraction*.06*coldRetention+p.volatileFraction*.04*volatileRetention));
 const atmosphericWeathering=clamp(Math.log10(1+Math.max(0,p.pressurePa))/7);
 const detail=fbm([d[0]*47,d[1]*47,d[2]*47],seed+97,3);
 // Додаткові мікродеталі відкриваються поступово разом із геодезичним LOD.
 const micro=fbm([d[0]*24,d[1]*24,d[2]*24],seed+401,Math.max(1,Math.min(6,lodLevel+1)));
 let height=0,color:[number,number,number]=[.35,.34,.31],rough=.88,material=1;
 if(p.kind==='oceanic'||p.waterFraction>.45){
  const continental=smooth(-.08,.13,macro-.48+plate.elevation+tectonic*.09);
  const trench=boundary*boundary*p.tectonicActivity*.11;
  const mountains=Math.pow(boundary,.7)*p.tectonicActivity*.16;
  height=(macro-.5)*.18+(regional-.5)*.065+mountains-trench+volcanic*.035;
  const land=[.12+detail*.12,.22+detail*.14,.075+detail*.05],ocean=[.006+regional*.012,.035+regional*.035,.12+regional*.075];
  color=[0,1,2].map(i=>ocean[i]+(land[i]-ocean[i])*continental) as [number,number,number];
  rough=.12+continental*.76;material=continental>.5?2:3;
 }else if(p.kind==='icy'||p.kind==='ice-giant'){
  const fracture=1-Math.abs(fbm([d[0]*24,d[1]*24,d[2]*24],seed+151,4)-.5)*2;
  const craterField=fbm([d[0]*7.5,d[1]*7.5,d[2]*7.5],seed+163,5);
  const craterBasin=1-smooth(.28,.62,craterField),craterRim=smooth(.48,.72,craterField)*(1-smooth(.76,.94,craterField));
  const ridge=1-Math.abs(fbm([d[0]*38,d[1]*38,d[2]*38],seed+173,4)*2-1);
  const cryovolcanic=fbm([d[0]*16,d[1]*16,d[2]*16],seed+181,4)*p.volcanicActivity;
  const ice=clamp(p.iceFraction),rock=clamp(p.silicateFraction*.72+p.ironFraction*.55);
  height=(macro-.5)*(.045+rock*.05)+fracture*p.tectonicActivity*.045+ridge*p.tectonicActivity*.035
   -craterBasin*p.age*.055+craterRim*p.age*.018+cryovolcanic*.04;
  const iceTone=.24+ice*.48+detail*.1;
  color=[iceTone*(.78+rock*.22),iceTone*(.9-rock*.18),iceTone*(1.02-rock*.3)];
  color=color.map((value,index)=>value*(1-rock*.38)+(index===0?.075:index===1?.085:.095)*rock) as [number,number,number];
  const fractureShade=clamp(fracture*p.tectonicActivity*.42);
  color=color.map(value=>value*(1-fractureShade*.3)+.035*fractureShade) as [number,number,number];
  color=color.map((value,index)=>value+((index===0?.72:index===1?.82:.94)-value)*clamp(cryovolcanic*.16)) as [number,number,number];
  rough=clamp(.24+(1-ice)*.58+p.age*.08);material=4;
 }else if(p.kind==='volcanic'){
  const lava=smooth(.62,.86,fbm([d[0]*13,d[1]*13,d[2]*13],seed+181,5)+volcanic*.4),sulfur=clamp(p.sulfurFraction*1.4);
  height=(macro-.5)*.08+volcanic*.16+boundary*.035;
  color=[.13+lava*.55+sulfur*.12,.09+lava*.19+sulfur*.11,.055+lava*.04+sulfur*.02];rough=.58;material=5;
 }else{
  const mountains=Math.pow(1-Math.abs(fbm([d[0]*8,d[1]*8,d[2]*8],seed+211,5)-.5)*2,2);
  const crater=1-smooth(.18,.42,fbm([d[0]*9,d[1]*9,d[2]*9],seed+223,4));
  height=(macro-.5)*.13+mountains*p.tectonicActivity*.16-crater*p.age*(.075-.018*atmosphericWeathering)+volcanic*.035;
  const oxide=clamp(p.ironFraction*.75+detail*.2),hydration=clamp(p.waterFraction*.16+p.volatileFraction*.12);
  color=[.22+oxide*.35+regional*.08+hydration*.035,.19+oxide*.12+detail*.05+hydration*.045,.16+detail*.04+hydration*.055];rough=clamp(.82-atmosphericWeathering*.18);material=1;
 }
 if(p.kind==='desert'){const dune=fbm([d[0]*55,d[1]*13,d[2]*55],seed+241,3);height+=(dune-.5)*.055;color=[.48+dune*.2,.27+dune*.13,.12+dune*.07];rough=.94;material=6;}
 if(p.kind!=='gas-giant'&&p.kind!=='ice-giant'&&frost>.02){color=color.map((v,i)=>v+((i===0?.84:i===1?.9:.96)-v)*frost) as [number,number,number];height*=1-frost*.3;rough=rough*(1-frost)+.32*frost;material=4;}
 height*=clamp(1-p.erosion*.55,.2,1.2)*clamp(1-atmosphericWeathering*.12,.75,1)*clamp(Math.sqrt(9.81/Math.max(.15,p.gravityMS2)),.45,1.7);
 // Мікрорельєф має фізичний масштаб і не перевищує частку допустимого перепаду висот.
 height+=(micro-.5)*.003;
 const microTone=(micro-.5)*.055;
 color=color.map(value=>clamp(value*(1+microTone))) as [number,number,number];
 rough=clamp(rough+(micro-.5)*.045);
 height+=(detail-.5)*.006;
 return{color,height,rough,material};
}
function atmosphereSample(d:Vec3,p:SurfaceProfile):{color:[number,number,number];height:number;rough:number;material:number}{
 const latitude=d[1],seed=p.seed,flow=fbm([d[0]*5,d[1]*17,d[2]*5],seed+301,5);
 const cloud=fbm([d[0]*19,d[1]*39,d[2]*19],seed+331,4);
 const vortex=fbm([d[0]*8+flow,d[1]*5,d[2]*8-flow],seed+367,5);
 const jet=Math.sin((latitude*(p.kind==='gas-giant'?38:25)+flow*.13)*Math.PI*2);
 const bands=smooth(-.4,.55,jet+(flow-.5)*.8),storm=smooth(.67,.9,cloud+vortex*.18);
 if(p.bodyId==='saturn')return{color:[.48+bands*.22+storm*.08,.36+bands*.18+storm*.04,.22+bands*.12],height:0,rough:.76,material:10};
 if(p.bodyId==='jupiter')return{color:[.28+bands*.42+storm*.22,.16+bands*.28+storm*.08,.09+bands*.17],height:0,rough:.72,material:10};
 if(p.bodyId==='uranus')return{color:[.12+bands*.08+cloud*.08,.36+bands*.2+cloud*.08,.48+bands*.24+cloud*.1],height:0,rough:.7,material:10};
 return{color:[.045+bands*.1+storm*.12,.12+bands*.18+storm*.14,.32+bands*.3+storm*.2],height:0,rough:.68,material:10};
}
function heightLimitM(p:SurfaceProfile):{negative:number;positive:number}{
 const known:Record<string,readonly [number,number]>={
  earth:[11000,9000],mars:[22000,22000],moon:[11000,11000],mercury:[10000,10000],venus:[12000,12000],
  io:[17000,17000],europa:[3000,3000],ganymede:[10000,10000],callisto:[10000,10000],titan:[5000,5000],
  triton:[2000,2000],phobos:[5000,5000],deimos:[3000,3000]
 };
 const limits=known[p.bodyId.toLowerCase()];
 if(limits)return{negative:limits[0],positive:limits[1]};
 const generic=Math.max(10,Math.min(50000,p.meanRadiusM*.003));
 return{negative:generic,positive:generic};
}

export function surfaceTileKey(request:SurfaceTileRequest):string{
 const p=request.profile,t=request.tile;
 // Канонічний порядок полів робить ключ стабільним і враховує всі параметри генерації.
 // JSON-структура використовується без lossy-хешування: різні профілі не зливаються в один ключ.
 return JSON.stringify({
  planetId:request.planetId,
  requestSeed:request.seed,
  profile:{
   bodyId:p.bodyId,seed:p.seed,kind:p.kind,massKg:p.massKg,meanRadiusM:p.meanRadiusM,
   gravityMS2:p.gravityMS2,temperatureK:p.temperatureK,pressurePa:p.pressurePa,
   waterFraction:p.waterFraction,iceFraction:p.iceFraction,ironFraction:p.ironFraction,
   silicateFraction:p.silicateFraction,volatileFraction:p.volatileFraction,sulfurFraction:p.sulfurFraction,
   tectonicActivity:p.tectonicActivity,volcanicActivity:p.volcanicActivity,erosion:p.erosion,
   age:p.age,rotationPeriodSeconds:p.rotationPeriodSeconds,algorithmVersion:p.algorithmVersion
  },
  tile:{face:t.face,path:t.path,level:t.level},
  resolution:request.resolution,
  gutter:request.gutter??2
 });
}
export function generateSurfaceTile(request:SurfaceTileRequest):SurfaceTileData{
 const started=performanceNow(),{tile,resolution,profile}=request,gutter=request.gutter??2;
 if(!Number.isInteger(resolution)||resolution<8||resolution>1024)throw new RangeError('Surface tile resolution must be in [8, 1024].');
 if(!Number.isInteger(gutter)||gutter<0||gutter>16)throw new RangeError('Surface tile gutter must be in [0, 16].');
 const width=resolution+2*gutter,count=width*width;
 const albedo=new Uint8Array(count*4),normal=new Uint8Array(count*3),height=new Float32Array(count),roughness=new Uint8Array(count),materialId=new Uint8Array(count);
 const resolved=resolveGeoTile(tile),plateSet=profile.kind==='gas-giant'||profile.kind==='ice-giant'?[]:plates(request.seed,profile);
 const sampleDirection=(direction:Vec3,lodLevel:number)=>profile.kind==='gas-giant'||profile.kind==='ice-giant'?atmosphereSample(direction,profile):geologicalSample(direction,profile,plateSet,lodLevel);
 // Кожен texel семплюється лише один раз; нормалі будуються з готового поля displacement.
 // Це усуває чотири повторні повні геологічні обчислення на кожен texel.
 const limits=heightLimitM(profile);
 const heightFraction=(value:number)=>clamp(value*(value<0?limits.negative:limits.positive)/profile.meanRadiusM,-limits.negative/profile.meanRadiusM,limits.positive/profile.meanRadiusM);
 const directions=new Float64Array(count*3);
 const displacedPositions=new Float64Array(count*3);
 let index=0;
 for(let row=-gutter;row<resolution+gutter;row++){
  for(let col=-gutter;col<resolution+gutter;col++){
   // Gutter продовжує глобальне сферичне поле за межі сторінки.
   const pageX=(col+.5)/resolution,pageY=(row+.5)/resolution;
   const [u,v]=squareToTriangleBarycentric(pageX,pageY);
   const direction=barycentricDirection(resolved.triangle,u,v);
   const sample=sampleDirection(direction,tile.level);
   const physicalHeight=heightFraction(sample.height)*profile.meanRadiusM;
   directions.set(direction,index*3);
   const radiusScale=1+physicalHeight/profile.meanRadiusM;
   displacedPositions[index*3]=direction[0]*radiusScale;
   displacedPositions[index*3+1]=direction[1]*radiusScale;
   displacedPositions[index*3+2]=direction[2]*radiusScale;
   albedo.set([Math.round(clamp(sample.color[0])*255),Math.round(clamp(sample.color[1])*255),Math.round(clamp(sample.color[2])*255),255],index*4);
   height[index]=physicalHeight;
   roughness[index]=Math.round(clamp(sample.rough)*255);
   materialId[index]=sample.material;
   index++;
  }
 }
 // Нормаль отримується з похідних уже зміщеної геометрії, а не з повторної генерації шуму.
 // Такий підхід зберігає узгодженість Height/Normal і зменшує вартість генерації сторінки.
 for(let row=0;row<width;row++){
  for(let col=0;col<width;col++){
   const left=row*width+Math.max(0,col-1),right=row*width+Math.min(width-1,col+1);
   const up=Math.max(0,row-1)*width+col,down=Math.min(width-1,row+1)*width+col;
   const dx=[displacedPositions[right*3]-displacedPositions[left*3],displacedPositions[right*3+1]-displacedPositions[left*3+1],displacedPositions[right*3+2]-displacedPositions[left*3+2]];
   const dy=[displacedPositions[down*3]-displacedPositions[up*3],displacedPositions[down*3+1]-displacedPositions[up*3+1],displacedPositions[down*3+2]-displacedPositions[up*3+2]];
   let nx=dx[1]*dy[2]-dx[2]*dy[1],ny=dx[2]*dy[0]-dx[0]*dy[2],nz=dx[0]*dy[1]-dx[1]*dy[0];
   const offset=(row*width+col)*3,rx=directions[offset],ry=directions[offset+1],rz=directions[offset+2];
   if(nx*rx+ny*ry+nz*rz<0){nx=-nx;ny=-ny;nz=-nz;}
   const length=Math.hypot(nx,ny,nz);
   if(length<1e-12){nx=rx;ny=ry;nz=rz;}else{nx/=length;ny/=length;nz/=length;}
   normal.set([Math.round((nx*.5+.5)*255),Math.round((ny*.5+.5)*255),Math.round((nz*.5+.5)*255)],row*width*3+col*3);
  }
 }
 return{key:surfaceTileKey(request),resolution,gutter,albedo,normal,height,roughness,materialId,generationMs:Math.max(0,performanceNow()-started)};
}
function normalize3(v:Vec3):[number,number,number]{const length=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])||1;return[v[0]/length,v[1]/length,v[2]/length];}
function cross3(a:Vec3,b:Vec3):[number,number,number]{return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}

function performanceNow():number{return typeof performance!=='undefined'?performance.now():Date.now();}
