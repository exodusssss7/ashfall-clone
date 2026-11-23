import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWorld, getWorldCell } from './survivalLogic';
import { isRemovedTunnelGuardhouse, removeObsoleteGuardhouseEntities } from './tunnelGuardhouseRepair';
import type { CubeFaceId, DoorEntity, LootContainer } from './types';

for (const [face,gx,gy] of [[3,116,-368],[5,108,40]] as const) {
  test(`approved guardhouse removed, face ${face}`, () => {
    const w=generateWorld(1994);
    for(let y=gy-6;y<=gy-2;y++)for(let x=gx+3;x<=gx+7;x++) {
      const c=getWorldCell(w.worldStore,x,y,face);
      assert.notEqual(c.tile,'tile_clinic');
      assert.notEqual(c.prop,'door');
      assert.notEqual(c.prop,'med_cabinet');
      assert.notEqual(c.prop,'crate_military');
    }
  });
  test(`old saved guardhouse entities removed exactly, face ${face}`,()=>{
    const doors=[{id:`door_${gx+5}_${gy-2}`,gx:gx+5,gy:gy-2},{id:'unrelated_door',gx:gx+5,gy:gy-2}] as DoorEntity[];
    const containers=[{id:`c_${gx+4}_${gy-5}`,gx:gx+4,gy:gy-5,kind:'med_cabinet'}, {id:`c_${gx+6}_${gy-5}`,gx:gx+6,gy:gy-5,kind:'crate_military'}, {id:'dropped_loot',gx:gx+4,gy:gy-5,kind:'zombie_drop'}] as LootContainer[];
    const original={doors,containers,inventory:{bandage:9},structures:[{id:'player-built'}]};
    const clean=removeObsoleteGuardhouseEntities(1994,face,original);
    assert.deepEqual(clean.doors,[doors[1]]);assert.deepEqual(clean.containers,[containers[2]]);
    assert.equal(clean.inventory,original.inventory);assert.equal(clean.structures,original.structures);
    assert.equal(original.doors.length,2);assert.equal(original.containers.length,3);
    assert.equal(removeObsoleteGuardhouseEntities(1995,face,original),original);
    assert.equal(removeObsoleteGuardhouseEntities(1994,0,original),original);
  });
}
test('other partial overlap guardhouses remain',()=>{
 for(const [face,gx,gy] of [[3,-76,-366],[4,-426,-426],[4,-278,462],[4,362,464]] as const){
   assert.equal(isRemovedTunnelGuardhouse(1994,face,gx,gy),false);
   const w=generateWorld(1994);assert.equal(getWorldCell(w.worldStore,gx+4,gy-4,face as CubeFaceId).tile,'tile_clinic');
 }
});
