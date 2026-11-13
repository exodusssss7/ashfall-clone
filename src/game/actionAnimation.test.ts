import test from 'node:test';
import assert from 'node:assert/strict';
import {actionPose} from './actionAnimation';
import {createInitialPlayer,tickSurvivalNeeds,useConsumableItem,createInitialInventory} from './survivalLogic';
test('action poses advance, remain finite and clamp at both ends',()=>{
 for(const remaining of [3,2,1.5,1,.5,0,-1]){
  const pose=actionPose({kind:'heal',label:'HEAL',duration:2,remaining});
  assert.ok(pose.progress>=0&&pose.progress<=1);assert.ok(Number.isFinite(pose.pulse));
 }
 assert.notDeepEqual(actionPose({kind:'craft',label:'',duration:2,remaining:1.7}),actionPose({kind:'craft',label:'',duration:2,remaining:1.4}));
});
test('survivor has no stamina resource before or after extended sprinting',()=>{
 let p=createInitialPlayer();for(let i=0;i<100;i++)p=tickSurvivalNeeds(p,.1,true,false);
 assert.equal('stamina' in p,false);assert.equal('maxStamina' in p,false);
});
test('water has no hidden stamina effect or waste at full hydration',()=>{
 const p={...createInitialPlayer(),thirst:100};assert.equal(useConsumableItem(p,createInitialInventory(),'water').used,false);
});
