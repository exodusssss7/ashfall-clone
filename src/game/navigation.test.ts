import test from 'node:test';
import assert from 'node:assert/strict';
import { findZombieRoute } from './navigation';
import { generateWorld, isCircleBlocked } from './survivalLogic';

test('route walks around the clinic wall instead of oscillating at the corner',()=>{
 const world=generateWorld(1994);
 const route=findZombieRoute(world.worldStore,13.2,18.5,24.5,18.5,world.vehicles);
 assert.ok(route.length>12);
 assert.deepEqual(route.at(-1),{x:24.5,y:18.5});
 for(const p of route)assert.equal(isCircleBlocked(world.worldStore,p.x,p.y,.24,world.vehicles,null),false);
});
test('negative streamed coordinates and blocked targets terminate safely',()=>{
 const world=generateWorld(1994);
 assert.deepEqual(findZombieRoute(world.worldStore,-80,-80,-79,-80),[]);
 const route=findZombieRoute(world.worldStore,13.2,18.5,15.5,15.5,world.vehicles);
 assert.deepEqual(route,[]);
});
test('routes preserve closed-door breach paths',()=>{
 const world=generateWorld(1994);
 const route=findZombieRoute(world.worldStore,39.5,23.5,39.5,21.5,world.vehicles);
 assert.ok(route.some(p=>p.x===39.5&&p.y===22.5));
 assert.equal(world.doors.find(d=>d.gx===39&&d.gy===22)?.status,'closed');
});

test('pursuit can plan toward a survivor inside a car without ignoring other cars',()=>{
 const world=generateWorld(1994);
 const target=world.vehicles[0];
 const route=findZombieRoute(world.worldStore,24.5,18.5,target.x,target.y,world.vehicles);
 assert.ok(route.length>0);
 assert.equal(Math.floor(route.at(-1)!.x),Math.floor(target.x));
});
