import { baseGeoTiles, childrenOf, type GeoTile } from './icosphere.ts';
import { findTileNeighbors, type TileNeighborMap } from './tile-neighbors.ts';
import { balanceGeodesicTiles } from './quadtree-balancer.ts';
import { buildStitchIndexTemplate, type StitchEdgeMask } from './tile-stitching.ts';

export interface GeodesicTileState {
 readonly tile:GeoTile;
 readonly visible:boolean;
 readonly stitchMask:StitchEdgeMask;
 readonly priority:number;
}
export interface GeodesicTopologyStats {
 readonly updatedTiles:number;
 readonly changedLinks:number;
 readonly checkedEdges:number;
 readonly recomputedMasks:number;
 readonly fullRebuilds:number;
 readonly updateMs:number;
}
export interface GeodesicRuntimeOptions {
 readonly maxDepth?:number;
 readonly maxTiles?:number;
 readonly stitchResolution?:number;
}
const now=()=>typeof performance!=='undefined'?performance.now():Date.now();

/** Persistent per-planet CPU state for the active geodesic leaf cover. */
export class GeodesicSurfaceRuntime {
 readonly planetId:string;
 private readonly options:Required<GeodesicRuntimeOptions>;
 private active=new Map<string,GeoTile>();
 private visible=new Set<string>();
 private visibilityConfigured=false;
 private neighbors:TileNeighborMap=findTileNeighbors([]);
 private masks=new Map<string,StitchEdgeMask>();
 private priorities=new Map<string,number>();
 private topologyVersion=0;
 private fullRebuilds=0;
 private lastStats:GeodesicTopologyStats={updatedTiles:0,changedLinks:0,checkedEdges:0,recomputedMasks:0,fullRebuilds:0,updateMs:0};
 private lastDesiredSignature:string|null=null;

 constructor(planetId:string,options:GeodesicRuntimeOptions={}){
  if(!planetId.trim())throw new TypeError('Planet id must not be empty.');
  this.planetId=planetId;
  this.options={maxDepth:options.maxDepth??12,maxTiles:options.maxTiles??4096,stitchResolution:options.stitchResolution??16};
  if(this.options.stitchResolution%2!==0||this.options.stitchResolution<2||this.options.stitchResolution>64)throw new RangeError('Stitch resolution must be an even value in [2, 64].');
  for(const tile of baseGeoTiles())this.active.set(tile.id.key,tile);
  this.rebuildTopology();
 }

 get version():number{return this.topologyVersion;}
 get activeTiles():readonly GeoTile[]{return [...this.active.values()];}
 get neighborMap():TileNeighborMap{return this.neighbors;}
 get topologyStats():GeodesicTopologyStats{return this.lastStats;}

 setVisible(tileKeys:ReadonlySet<string>):void{
  this.visible=new Set([...tileKeys].filter(key=>this.active.has(key)));
  this.visibilityConfigured=true;
 }
 setPriority(tileKey:string,priority:number):void{
  if(!this.active.has(tileKey))throw new RangeError('Priority can only be assigned to an active leaf.');
  if(!Number.isFinite(priority))throw new RangeError('Tile priority must be finite.');
  this.priorities.set(tileKey,priority);
 }
 getTileStates():readonly GeodesicTileState[]{
  return [...this.active.values()].map(tile=>({tile,visible:!this.visibilityConfigured||this.visible.has(tile.id.key),stitchMask:this.masks.get(tile.id.key)??0,priority:this.priorities.get(tile.id.key)??0}));
 }

 split(tileKey:string):boolean{
  const parent=this.active.get(tileKey);if(!parent||parent.id.level>=this.options.maxDepth||this.active.size+3>this.options.maxTiles)return false;
  const children=childrenOf(parent);
  if(children.some(child=>this.active.has(child.id.key)))throw new Error('Split would create duplicate active leaves.');
  this.active.delete(tileKey);this.visible.delete(tileKey);this.priorities.delete(tileKey);this.lastDesiredSignature=null;
  for(const child of children)this.active.set(child.id.key,child);
  this.balanceAndRebuild();
  return true;
 }

 merge(parentKey:string):boolean{
  const separator=parentKey.indexOf(':');
  if(separator<1)return false;
  const face=parseInt(parentKey.slice(0,separator),36),path=parentKey.slice(separator+1);
  if(!Number.isInteger(face)||face<0||face>=20)return false;
  const parentTile=this.resolveTile(face,path==='root'?'':path);
  if(parentTile.id.key!==parentKey)return false;
  const childKeys=childrenOf(parentTile).map(child=>child.id.key);
  if(!childKeys.every(key=>this.active.has(key)))return false;
  const candidate=new Map(this.active);
  for(const key of childKeys)candidate.delete(key);
  candidate.set(parentTile.id.key,parentTile);
  const validation=findTileNeighbors([...candidate.values()]);
  if(validation.links.some(link=>Math.abs(link.tile.id.level-link.neighbor.id.level)>1))return false;
  for(const key of childKeys){this.active.delete(key);this.visible.delete(key);this.priorities.delete(key);}
  this.active.set(parentTile.id.key,parentTile);
  this.lastDesiredSignature=null;
  this.rebuildTopology();
  return true;
 }
 /** Reconcile a complete desired leaf cover. Parents are replaced atomically by descendants and vice versa. */
 reconcile(desired:readonly GeoTile[],visibleKeys?:ReadonlySet<string>,maxTiles=this.options.maxTiles):void{
  const next=new Map<string,GeoTile>();
  for(const tile of desired){
   if(next.has(tile.id.key))throw new Error('Desired leaf set contains duplicate tiles.');
   next.set(tile.id.key,tile);
  }
  this.assertAntichain(next);
  if(!Number.isInteger(maxTiles)||maxTiles<20||maxTiles>this.options.maxTiles)throw new RangeError('Reconcile tile budget must be in [20, configured maxTiles].');
  if(next.size>maxTiles)throw new RangeError('Desired leaf set exceeds the configured tile budget.');
  // Однакове дерево не потребує повторного балансування та квадратичного пошуку сусідів кожен кадр.
  const desiredSignature=maxTiles+'|'+[...next.keys()].sort().join(',');
  const requestedVisible=visibleKeys??new Set(next.keys());
  if(desiredSignature===this.lastDesiredSignature){
   this.visible=new Set([...this.active.values()]
    .filter(tile=>isVisibleLeafOrDescendant(tile,requestedVisible))
    .map(tile=>tile.id.key));
   this.visibilityConfigured=true;
   return;
  }
  const balanced=balanceGeodesicTiles([...next.values()],{maxDepth:this.options.maxDepth,maxTiles});
  if(balanced.violations>0)throw new Error('Desired leaf set cannot satisfy the 2:1 balance within configured limits.');
  this.active=new Map(balanced.tiles.map(tile=>[tile.id.key,tile]));
  // Балансувальні листки поза видимим піддеревом зберігаються для топології, але не надсилаються на GPU.
  this.visible=new Set(balanced.tiles
   .filter(tile=>isVisibleLeafOrDescendant(tile,requestedVisible))
   .map(tile=>tile.id.key));
  this.visibilityConfigured=true;
  this.lastDesiredSignature=desiredSignature;
  this.rebuildTopology();
 }

 private balanceAndRebuild():void{
  this.lastDesiredSignature=null;
  const balanced=balanceGeodesicTiles([...this.active.values()],{maxDepth:this.options.maxDepth,maxTiles:this.options.maxTiles});
  this.active=new Map(balanced.tiles.map(tile=>[tile.id.key,tile]));
  this.rebuildTopology();
 }
 private rebuildTopology():void{
  const started=now(),previousLinks=new Set(this.neighbors.links.map(link=>link.tile.id.key+'>'+link.neighbor.id.key+':'+link.edge));
  this.neighbors=findTileNeighbors([...this.active.values()]);
  const nextMasks=new Map<string,StitchEdgeMask>();
  for(const tile of this.active.values())nextMasks.set(tile.id.key,0);
  for(const link of this.neighbors.links){
   if(link.neighbor.id.level>=link.tile.id.level)continue;
   nextMasks.set(link.tile.id.key,(nextMasks.get(link.tile.id.key)??0)|(1<<link.edge));
  }
  let recomputedMasks=0;
  for(const [key,mask] of nextMasks){
   if(this.masks.get(key)!==mask){recomputedMasks++;buildStitchIndexTemplate(this.options.stitchResolution,mask);}
  }
  const nextLinks=new Set(this.neighbors.links.map(link=>link.tile.id.key+'>'+link.neighbor.id.key+':'+link.edge));
  let changedLinks=0;for(const key of previousLinks)if(!nextLinks.has(key))changedLinks++;
  for(const key of nextLinks)if(!previousLinks.has(key))changedLinks++;
  const updatedTiles=new Set([...this.masks.keys(),...nextMasks.keys()]);
  this.masks=nextMasks;this.topologyVersion++;this.fullRebuilds++;
  this.lastStats={updatedTiles:updatedTiles.size,changedLinks,checkedEdges:this.neighbors.comparisons*2,recomputedMasks,fullRebuilds:this.fullRebuilds,updateMs:Math.max(0,now()-started)};
 }
 private assertAntichain(tiles:Map<string,GeoTile>):void{
  for(const tile of tiles.values()){
   for(let length=0;length<tile.id.path.length;length++){
    const ancestor=tile.id.face.toString(36)+':'+(length===0?'root':tile.id.path.slice(0,length));
    if(tiles.has(ancestor))throw new Error('Active leaf set contains a parent and its descendant.');
   }
  }
 }
 private resolveParentTriangle(face:number,path:string){return this.resolveTile(face,path).triangle;}
 private resolveTile(face:number,path:string):GeoTile{
  const root=baseGeoTiles()[face];
  let tile=root;
  for(const digit of path)tile=childrenOf(tile)[Number(digit)];
  return tile;
 }
}


/** Балансувальні нащадки видимого листка залишаються видимими; сторонні листки — лише топологічні. */
function isVisibleLeafOrDescendant(tile:GeoTile,visibleKeys:ReadonlySet<string>):boolean{
 if(visibleKeys.has(tile.id.key))return true;
 for(let length=0;length<tile.id.path.length;length++){
  const ancestor=tile.id.face.toString(36)+':'+(length===0?'root':tile.id.path.slice(0,length));
  if(visibleKeys.has(ancestor))return true;
 }
 return false;
}
