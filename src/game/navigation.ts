import { isCircleBlocked } from './survivalLogic';
import { readCellFromSource, type CellSource } from './isometric';
import { isTerrainStepBlocked, sampleTerrainHeight } from './terrainSystem';
import type { Vehicle } from './types';

export interface RoutePoint { x: number; y: number }

// Bounded tile A*: cardinal steps prevent corner cutting. Door tiles are allowed
// in a route so infected still break doors instead of treating them as walls.
// On hilly outer frontier terrain, routes respect bridge guardrails, tunnel walls,
// and impassable cliff steps while gently preferring flatter passes & bridges.
export function findZombieRoute(source: CellSource, sx: number, sy: number, tx: number, ty: number, vehicles: Vehicle[] = []): RoutePoint[] {
  const startX = Math.floor(sx), startY = Math.floor(sy);
  const goalX = Math.floor(tx), goalY = Math.floor(ty);
  if (startX === goalX && startY === goalY) return [];
  const seed = !Array.isArray(source) && 'seed' in source ? source.seed : null;
  const face = !Array.isArray(source) && 'activeFace' in source ? source.activeFace : 0;
  // The pursued survivor may be inside a vehicle. Route toward that vehicle
  // while keeping all other cars as obstacles; real collision still stops bites.
  const blockers = vehicles.filter(v => Math.hypot(v.x-tx,v.y-ty) > 1.6);
  const margin = 16;
  const minX = Math.min(startX, goalX) - margin, maxX = Math.max(startX, goalX) + margin;
  const minY = Math.min(startY, goalY) - margin, maxY = Math.max(startY, goalY) + margin;
  const key = (x: number, y: number) => `${x},${y}`;
  type Node = { x: number; y: number; g: number; f: number; parent: Node | null };
  const first: Node = { x: startX, y: startY, g: 0, f: Math.abs(goalX-startX)+Math.abs(goalY-startY), parent: null };
  const open: Node[] = [first], costs = new Map<string, number>([[key(startX,startY), 0]]);
  let visited = 0;
  while (open.length && visited++ < 2400) {
    let best = 0;
    for (let i=1;i<open.length;i++) if(open[i].f < open[best].f) best=i;
    const n = open.splice(best,1)[0];
    if (n.g !== costs.get(key(n.x,n.y))) continue;
    if (n.x===goalX && n.y===goalY) {
      const route: RoutePoint[]=[];
      for(let p: Node|null=n;p?.parent;p=p.parent) route.push({x:p.x+.5,y:p.y+.5});
      return route.reverse();
    }
    const fromH = seed !== null ? sampleTerrainHeight(seed, n.x + 0.5, n.y + 0.5, face) : 0;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x=n.x+dx,y=n.y+dy,k=key(x,y);
      if(x<minX||x>maxX||y<minY||y>maxY) continue;
      // A door's collision is temporarily ignored for planning only. Movement
      // and attacks keep the real collision and door damage rules intact.
      const cell = readCellFromSource(source,x,y);
      if (!cell) continue;
      if(cell.prop!=='door' && isCircleBlocked(source,x+.5,y+.5,.24,blockers,null)) continue;
      let slopePenalty = 0;
      if (seed !== null) {
        if (isTerrainStepBlocked(seed, n.x + 0.5, n.y + 0.5, x + 0.5, y + 0.5, 0.72, face)) continue;
        const toH = sampleTerrainHeight(seed, x + 0.5, y + 0.5, face);
        if (toH > fromH + 0.1) slopePenalty = (toH - fromH) * 0.75;
      }
      const waterPenalty = cell.tile === 'water' ? 0.6 : 0;
      const g=n.g+1+(cell.prop==='door'&&cell.solid?3:0)+slopePenalty+waterPenalty;
      if(g >= (costs.get(k)??Infinity)) continue;
      costs.set(k,g);open.push({x,y,g,f:g+Math.abs(goalX-x)+Math.abs(goalY-y),parent:n});
    }
  }
  return [];
}
