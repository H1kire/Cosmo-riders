import { baseGeoTiles, childrenOf, type GeoTile, type Vec3 } from './icosphere.ts';

export interface GeodesicLodCamera {
 readonly positionM:Vec3;
 readonly forward:Vec3;
 readonly verticalFovRadians:number;
 readonly viewportHeightPx:number;
 readonly viewportWidthPx:number;
}
export interface GeodesicLodOptions {
 readonly planetRadiusM:number;
 readonly targetErrorPx?:number;
 readonly maxDepth?:number;
 readonly maxTiles?:number;
 readonly previousSplitKeys?:ReadonlySet<string>;
}
export interface GeodesicLodStats {
 readonly tested:number;
 readonly culledFrustum:number;
 readonly culledHorizon:number;
 readonly split:number;
 readonly leaves:number;
 readonly maxLevel:number;
 readonly maxScreenErrorPx:number;
}
export interface GeodesicLodSelection { readonly tiles:readonly GeoTile[]; readonly stats:GeodesicLodStats; }

const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const normalize=(v:Vec3):Vec3=>{const length=Math.hypot(...v)||1;return[v[0]/length,v[1]/length,v[2]/length];};
const angle=(a:Vec3,b:Vec3)=>Math.acos(Math.max(-1,Math.min(1,dot(a,b))));

interface CachedTileGeometry { readonly center: Vec3; readonly angularRadius: number; readonly sagittaFactor: number; }
const tileGeometryCache = new Map<string, CachedTileGeometry>();
function tileGeometry(tile:GeoTile):CachedTileGeometry {
 const cached=tileGeometryCache.get(tile.id.key);if(cached)return cached;
 const center=normalize([tile.triangle.a[0]+tile.triangle.b[0]+tile.triangle.c[0],tile.triangle.a[1]+tile.triangle.b[1]+tile.triangle.c[1],tile.triangle.a[2]+tile.triangle.b[2]+tile.triangle.c[2]]);
 const minDot=Math.max(-1,Math.min(1,Math.min(dot(center,tile.triangle.a),dot(center,tile.triangle.b),dot(center,tile.triangle.c))));
 const angularRadius=Math.acos(minDot);
 const value={center,angularRadius,sagittaFactor:1-Math.cos(angularRadius*0.5)};
 if(tileGeometryCache.size>65536)tileGeometryCache.clear();
 tileGeometryCache.set(tile.id.key,value);return value;
}
/** Maximum dot(direction, cameraDirection) over a spherical cap around center. */
export function horizonCapUpperBound(center:Vec3,cameraDirection:Vec3,angularRadius:number):number{
 const c=normalize(center),v=normalize(cameraDirection),alpha=Math.max(0,Math.min(Math.PI,angularRadius));
 const centerDot=Math.max(-1,Math.min(1,dot(c,v))),theta=Math.acos(centerDot);
 if(theta<=alpha)return 1;
 return Math.cos(theta-alpha);
}

/** Консервативна кутова оболонка прямокутного frustum включає його діагональні кути. */
export function isAngularCapPotentiallyVisibleInFrustum(
 directionToCenter:Vec3,angularRadius:number,cameraForward:Vec3,
 verticalFovRadians:number,viewportWidthPx:number,viewportHeightPx:number
):boolean{
 if(!Number.isFinite(angularRadius)||angularRadius<0)throw new RangeError('Angular radius must be finite and non-negative.');
 if(!Number.isFinite(verticalFovRadians)||verticalFovRadians<=0||verticalFovRadians>=Math.PI)throw new RangeError('Vertical field of view must be between zero and pi.');
 if(!Number.isFinite(viewportWidthPx)||viewportWidthPx<=0||!Number.isFinite(viewportHeightPx)||viewportHeightPx<=0)throw new RangeError('Viewport dimensions must be positive.');
 const halfVertical=verticalFovRadians*.5,aspect=viewportWidthPx/viewportHeightPx;
 const halfHorizontal=Math.atan(Math.tan(halfVertical)*aspect);
 const cornerAngle=Math.acos(Math.max(-1,Math.min(1,Math.cos(halfVertical)*Math.cos(halfHorizontal))));
 const halfAngle=Math.min(Math.PI,cornerAngle+angularRadius);
 return dot(normalize(directionToCenter),normalize(cameraForward))>=Math.cos(halfAngle);
}

/** Conservative frustum test for a sphere centered at the local origin. */
export function isSpherePotentiallyVisibleInFrustum(
 cameraPositionM:Vec3,cameraForward:Vec3,radiusM:number,
 verticalFovRadians:number,viewportWidthPx:number,viewportHeightPx:number
):boolean{
 if(!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('Sphere radius must be positive metres.');
 const distance=Math.hypot(...cameraPositionM);
 if(!Number.isFinite(distance)||distance<=radiusM)return true;
 const directionToCenter:Vec3=normalize([-cameraPositionM[0],-cameraPositionM[1],-cameraPositionM[2]]);
 const angularRadius=Math.asin(Math.max(0,Math.min(1,radiusM/distance)));
 return isAngularCapPotentiallyVisibleInFrustum(directionToCenter,angularRadius,cameraForward,verticalFovRadians,viewportWidthPx,viewportHeightPx);
}

/** A cap is culled only when even its most camera-facing point is below the geometric horizon. */
export function isTilePotentiallyVisibleFromHorizon(center:Vec3,angularRadius:number,cameraPositionM:Vec3,radiusM:number):boolean{
 if(!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('Planet radius must be positive metres.');
 const distance=Math.hypot(...cameraPositionM);
 if(!Number.isFinite(distance)||distance<=radiusM)return true;
 const cameraDirection=normalize(cameraPositionM);
 const upperBound=horizonCapUpperBound(center,cameraDirection,angularRadius);
 const horizonCosine=radiusM/distance;
 return upperBound+1e-12>=horizonCosine;
}
function isVisible(tile:GeoTile,camera:GeodesicLodCamera,radius:number,center:Vec3,angularRadius:number):'visible'|'frustum'|'horizon'{
 if(!isTilePotentiallyVisibleFromHorizon(center,angularRadius,camera.positionM,radius))return'horizon';
 const surfacePoint:[number,number,number]=[center[0]*radius,center[1]*radius,center[2]*radius];
 const toTile=normalize([surfacePoint[0]-camera.positionM[0],surfacePoint[1]-camera.positionM[1],surfacePoint[2]-camera.positionM[2]]);
 if(!isAngularCapPotentiallyVisibleInFrustum(
  toTile,angularRadius,camera.forward,camera.verticalFovRadians,camera.viewportWidthPx,camera.viewportHeightPx
 ))return'frustum';
 return'visible';
}

/** Selects visible icosphere leaves by projected spherical sagitta error with split/merge hysteresis. */
export function selectGeodesicLod(camera:GeodesicLodCamera,options:GeodesicLodOptions):GeodesicLodSelection{
 const radius=options.planetRadiusM,target=Math.max(.1,options.targetErrorPx??2),maxDepth=Math.max(0,Math.min(20,Math.trunc(options.maxDepth??12)));
 const maxTiles=Math.max(20,Math.trunc(options.maxTiles??4096));
 if(!Number.isFinite(radius)||radius<=0)throw new RangeError('Planet radius must be positive metres.');
 if(!Number.isFinite(camera.viewportHeightPx)||camera.viewportHeightPx<=0||!Number.isFinite(camera.viewportWidthPx)||camera.viewportWidthPx<=0)throw new RangeError('Viewport dimensions must be positive.');
 if(!Number.isFinite(camera.verticalFovRadians)||camera.verticalFovRadians<=0||camera.verticalFovRadians>=Math.PI)throw new RangeError('Vertical field of view must be between zero and pi.');
 const focalPixels=camera.viewportHeightPx/(2*Math.tan(camera.verticalFovRadians/2));
 let leafBudget=20;
 const selected:GeoTile[]=[],stats={tested:0,culledFrustum:0,culledHorizon:0,split:0,leaves:0,maxLevel:0,maxScreenErrorPx:0};
 const visit=(tile:GeoTile)=>{
  stats.tested++;
  const geometry=tileGeometry(tile),center=geometry.center,angularRadius=geometry.angularRadius,visibility=isVisible(tile,camera,radius,center,angularRadius);
  if(visibility==='frustum'){stats.culledFrustum++;return;}
  if(visibility==='horizon'){stats.culledHorizon++;return;}
  const surfaceDistance=Math.max(1,Math.hypot(camera.positionM[0]-center[0]*radius,camera.positionM[1]-center[1]*radius,camera.positionM[2]-center[2]*radius));
  const sagitta=radius*geometry.sagittaFactor;
  const errorPx=sagitta*focalPixels/surfaceDistance;
  stats.maxScreenErrorPx=Math.max(stats.maxScreenErrorPx,errorPx);
  const wasSplit=options.previousSplitKeys?.has(tile.id.key)??false;
  const threshold=target*(wasSplit?0.8:1.2);
  const canSplit=tile.id.level<maxDepth&&leafBudget+3<=maxTiles;
  if(errorPx>threshold&&canSplit){
   stats.split++;leafBudget+=3;for(const child of childrenOf(tile))visit(child);return;
  }
  selected.push(tile);stats.leaves++;stats.maxLevel=Math.max(stats.maxLevel,tile.id.level);
 };
 for(const tile of baseGeoTiles())visit(tile);
 return{tiles:selected,stats:Object.freeze(stats)};
}
