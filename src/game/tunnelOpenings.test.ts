import assert from 'node:assert/strict';
import test from 'node:test';
import { isTunnelEdgeWall, isTunnelOpeningEdge, isTerrainStepBlocked, isTunnelClaimedCell } from './terrainSystem';

const seed = 1994;
for (const [face,x,y,dx,dy] of [[4,433,26,1,0],[5,28,-315,0,-1],[5,-16,40,1,0]] as const) {
  test(`continuing highway stays open at tunnel end face ${face} (${x},${y})`, () => {
    assert.equal(isTunnelClaimedCell(seed,x,y,face),true);
    assert.equal(isTunnelClaimedCell(seed,x+dx,y+dy,face),false);
    assert.equal(isTunnelOpeningEdge(seed,x,y,x+dx,y+dy,face),true);
    assert.equal(isTunnelEdgeWall(seed,x,y,x+dx,y+dy,face),false);
    assert.equal(isTunnelEdgeWall(seed,x+dx,y+dy,x,y,face),false);
    for(let p=0;p<1;p+=.025){
      const ax=x+.5+dx*p,ay=y+.5+dy*p;
      assert.equal(isTerrainStepBlocked(seed,ax,ay,ax+dx*.025,ay+dy*.025,.68,face),false);
      assert.equal(isTerrainStepBlocked(seed,ax+dx*.025,ay+dy*.025,ax,ay,.68,face),false);
    }
  });
}
test('longitudinal openings do not remove tunnel retaining side walls', () => {
  let checked=0;
  for(let y=200;y<=213;y++)for(let x=28;x<=33;x++){
    if(!isTunnelClaimedCell(seed,x,y,0))continue;
    for(const dx of[-1,1]){
      if(isTunnelClaimedCell(seed,x+dx,y,0))continue;
      if(isTunnelOpeningEdge(seed,x,y,x+dx,y,0))continue;
      assert.equal(isTunnelEdgeWall(seed,x,y,x+dx,y,0),true);
      checked++;
    }
  }
  assert.ok(checked>0);
});
