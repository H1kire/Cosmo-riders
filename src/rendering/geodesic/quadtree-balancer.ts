import { childrenOf, type GeoTile } from './icosphere.ts';
import { findTileNeighbors } from './tile-neighbors.ts';

export interface GeodesicBalanceResult {
 readonly tiles:readonly GeoTile[];
 readonly checkedNeighborPairs:number;
 readonly splitOperations:number;
 readonly maxLevelDifference:number;
 readonly violations:number;
 readonly iterations:number;
 readonly budgetLimited:boolean;
}

/** Refines only coarse leaves that violate the 2:1 rule; terminates at depth/budget limits. */
export function balanceGeodesicTiles(input:readonly GeoTile[],options:{maxDepth?:number;maxTiles?:number}={}):GeodesicBalanceResult{
 const maxDepth=Math.max(0,Math.trunc(options.maxDepth??12)),maxTiles=Math.max(20,Math.trunc(options.maxTiles??4096));
 const active=new Map(input.map(tile=>[tile.id.key,tile]));
 if(active.size!==input.length)throw new Error('Input contains duplicate active geodesic tile IDs.');
 let checkedNeighborPairs=0,splitOperations=0,iterations=0,budgetLimited=false;
 while(iterations++<maxTiles){
  const neighbors=findTileNeighbors([...active.values()]);
  checkedNeighborPairs+=neighbors.links.length/2;
  const coarse=new Set<string>();
  for(const link of neighbors.links){
   const difference=link.tile.id.level-link.neighbor.id.level;
   if(Math.abs(difference)>1){
    const candidate=difference<0?link.tile:link.neighbor;
    if(candidate.id.level<maxDepth)coarse.add(candidate.id.key);
   }
  }
  if(coarse.size===0)break;
  let changed=false;
  for(const key of coarse){
   const parent=active.get(key);if(!parent)continue;
   if(parent.id.level>=maxDepth)continue;
   if(active.size+3>maxTiles){budgetLimited=true;continue;}
   active.delete(key);
   for(const child of childrenOf(parent))active.set(child.id.key,child);
   splitOperations++;changed=true;
  }
  if(!changed)break;
 }
 const finalNeighbors=findTileNeighbors([...active.values()]);
 let maxLevelDifference=0,violations=0;
 const pairs=new Set<string>();
 for(const link of finalNeighbors.links){
  const difference=Math.abs(link.tile.id.level-link.neighbor.id.level);
  maxLevelDifference=Math.max(maxLevelDifference,difference);
  if(difference>1){
   const key=link.tile.id.key<link.neighbor.id.key?link.tile.id.key+'|'+link.neighbor.id.key:link.neighbor.id.key+'|'+link.tile.id.key;
   pairs.add(key);
  }
 }
 violations=pairs.size;
 return{tiles:Object.freeze([...active.values()]),checkedNeighborPairs,splitOperations,maxLevelDifference,violations,iterations:Math.min(iterations,maxTiles),budgetLimited};
}
