export interface PhysicsSnapshot {
 readonly simulationTimeSeconds:number;readonly accumulatorSeconds:number;readonly timeScale:number;readonly paused:boolean;
 readonly bodyIds:readonly string[];readonly bodyStates:Float64Array;readonly vesselIds:readonly string[];readonly vesselPrimaryIds:readonly string[];readonly vesselStates:Float64Array;
}
export type PhysicsCommand=
 |{type:'initialize';catalog:readonly Record<string,unknown>[];options?:Record<string,number>}
 |{type:'advance';realDeltaSeconds:number}|{type:'step'}|{type:'set-time-scale';value:number}|{type:'set-paused';value:boolean}
 |{type:'add-vessel';vessel:Record<string,unknown>}|{type:'maneuver';vesselId:string;direction:readonly [number,number,number];deltaVMS:number}
 |{type:'snapshot'}|{type:'body-states-at';timeSeconds:number}|{type:'vessel-state';id:string}
 |{type:'vessel-state-at';id:string;timeSeconds:number;bodyStates:Float64Array}
 |{type:'sphere-of-influence';bodyId:string}|{type:'rotation-angle';bodyId:string;timeSeconds:number}|{type:'dispose'};
export interface PhysicsRequest{readonly id:number;readonly command:PhysicsCommand}
export interface PhysicsResponse{readonly id:number;readonly ok:boolean;readonly result?:unknown;readonly error?:string}
export interface AdvanceResult{readonly steps:number;readonly snapshot:PhysicsSnapshot}
