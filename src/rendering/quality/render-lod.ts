/** Screen-space LOD helpers shared by the solar renderer and tests. */
export function selectMeshLod(projectedRadius:number,maxLevel:number):number {
  const requested=projectedRadius>420?3:projectedRadius>70?2:projectedRadius>18?1:0;
  return Math.max(0,Math.min(Math.trunc(maxLevel),requested));
}

/** Fade only heliocentric orbit lines while a selected planet is approached. */
export function planetaryOrbitOpacity(cameraDistance:number,focusRadius:number):number {
  if(!Number.isFinite(cameraDistance)||!Number.isFinite(focusRadius)||focusRadius<=0)return 1;
  const ratio=Math.max(0,cameraDistance)/focusRadius;
  const t=Math.max(0,Math.min(1,(ratio-120)/(2400-120)));
  return t*t*(3-2*t);
}
