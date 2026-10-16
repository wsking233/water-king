import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLeaderboard,refreshedLeaderboard} from '../src/leaderboardData.ts';
const item=(rank=1,score=0)=>({nickname:'水友',rank,score,empty:true,incomplete:false});
const data=()=>({rows:Array.from({length:20},()=>item()),mine:null,total:41,hasMore:true,participating:null,snapshot:'a'.repeat(32),stale:false,updatedAt:new Date().toISOString(),day:'2026-10-17',goalHistoryAvailable:false});
test('unchanged refresh retains loaded pages; changed snapshots restart safely',()=>{
 const page=parseLeaderboard(data());const all={...page,rows:Array.from({length:41},()=>item()),hasMore:false};
 assert.equal(refreshedLeaderboard(all,page).rows.length,41);
 assert.equal(refreshedLeaderboard(all,{...page,snapshot:'b'.repeat(32)}).rows.length,20);
 assert.equal(parseLeaderboard({...data(),rows:[item()],hasMore:false},40).rows.length,1);
 assert.equal(parseLeaderboard({...data(),rows:[],stale:true},20).stale,true);
});
test('partial, impossible, unsorted or malformed results fail before rendering',()=>{
 const cases=[null,{}, {...data(),rows:[]}, {...data(),snapshot:'bad'}, {...data(),mine:item(),participating:null},
 {...data(),hasMore:false},{...data(),rows:[...data().rows.slice(0,19),item(42)]},
 {...data(),rows:[item(1,1),item(2,2),...data().rows.slice(2)]},
 {...data(),rows:[item(1,0),item(2,0),...data().rows.slice(2)]}];
 for(const value of cases)assert.throws(()=>parseLeaderboard(value));
 const withExtra={...data(),email:'private',rows:data().rows.map(i=>({...i,user_id:'private'}))};
 const safe=parseLeaderboard(withExtra);assert.equal('email' in safe,false);assert.equal('user_id' in safe.rows[0],false);
});
