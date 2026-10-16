import test from 'node:test';
import assert from 'node:assert/strict';
import { achievementIds,parseAchievements,readAchievementCache,achievementCacheKey } from '../src/achievementData.ts';
const page=()=>({rulesVersion:1,updatedAt:new Date().toISOString(),day:'2026-10-17',incompleteGoalHistory:false,achievedCount:0,
 items:achievementIds.map(id=>({id,title:'记录成就',description:'记录习惯',progress:0,target:3,unit:'天',achieved:false}))});
test('cache cannot move another account achievements into this account or local mode',()=>{
 const data=page();const storage={getItem:()=>JSON.stringify({owner:'user-a',page:data})};
 assert.deepEqual(readAchievementCache(storage,'user-a'),data);
 assert.equal(readAchievementCache(storage,'user-b'),null);assert.equal(readAchievementCache(storage,'local'),null);
 assert.notEqual(achievementCacheKey('user-a'),achievementCacheKey('user-b'));
});
test('bad, obsolete, duplicated or inconsistent server/cache data fails closed',()=>{
 for(const bad of [null,{}, {...page(),rulesVersion:2},{...page(),achievedCount:1},{...page(),updatedAt:'bad'},
 {...page(),items:[...page().items.slice(1),page().items[1]]}]) assert.throws(()=>parseAchievements(bad));
 const negative=page();negative.items[0].progress=-1;assert.throws(()=>parseAchievements(negative));
 const incompatible=page();incompatible.items[0].achieved=true;assert.throws(()=>parseAchievements(incompatible));
 assert.equal(readAchievementCache({getItem:()=>'{bad'},'user-a'),null);
 assert.equal(readAchievementCache({getItem:()=>{throw Error('storage blocked')}},'user-a'),null);
});
