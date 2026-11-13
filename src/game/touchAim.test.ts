import test from 'node:test';
import assert from 'node:assert/strict';
import { touchAimAttack, AIM_ATTACK_THRESHOLD } from './touchAim';
test('touchdown and inner aim ring never attack',()=>{
 for(const mag of [0,.01,.1,.25,AIM_ATTACK_THRESHOLD-.001])assert.equal(touchAimAttack(true,mag),false);
});
test('outer ring attacks and returning inside or releasing stops',()=>{
 for(const mag of [AIM_ATTACK_THRESHOLD,.75,1])assert.equal(touchAimAttack(true,mag),true);
 assert.equal(touchAimAttack(true,.3),false);
 assert.equal(touchAimAttack(false,1),false);
});
