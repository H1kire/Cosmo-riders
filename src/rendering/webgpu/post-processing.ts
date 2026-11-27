/** Повертає обмежену кількість пар горизонтального та вертикального blur-проходів. */
export function resolveBloomIterations(value?:number):number {
  if(value===undefined||!Number.isFinite(value))return 3;
  return Math.max(1,Math.min(8,Math.floor(value)));
}
