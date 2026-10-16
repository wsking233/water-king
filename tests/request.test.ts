import test from 'node:test';
import assert from 'node:assert/strict';
import {abortable} from '../src/cloud/request.ts';
test('aborting a session wait prevents a hung SDK from blocking UI; late rejection remains handled',async()=>{
 const controller=new AbortController();let lateReject:(e:Error)=>void=()=>{};
 const pending=abortable(new Promise((_,reject)=>{lateReject=reject}),controller.signal);
 controller.abort();await assert.rejects(pending,{name:'AbortError'});lateReject(Error('late network rejection'));
 assert.equal(await abortable(Promise.resolve(7),new AbortController().signal),7);
});
