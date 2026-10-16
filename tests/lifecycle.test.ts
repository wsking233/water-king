import test from "node:test";
import assert from "node:assert/strict";
import {guestExpiryMessage,shouldRestoreIdentity} from "../src/cloud/lifecycle.ts";

test("only an explicit server expiry marks a guest expired; network and other auth errors stay recoverable",()=>{
  assert.match(guestExpiryMessage({code:"PT401",message:"guest_expired"})!,/本机记录.*保留/);
  for(const cause of [null,Error("network"),{code:"401",message:"guest_expired"},{code:"PT401",message:"other"},{code:"PGRST202",message:"missing function"}])
    assert.equal(guestExpiryMessage(cause),null);
});

test("background token refresh and repeated same-user sign-in do not start an activity-renewing sync",()=>{
  for(const event of ["TOKEN_REFRESHED","USER_UPDATED","SIGNED_IN"])
    assert.equal(shouldRestoreIdentity("a","a",event),false);
  assert.equal(shouldRestoreIdentity(null,"a","SIGNED_IN"),true);
  assert.equal(shouldRestoreIdentity("a","b","SIGNED_IN"),true);
  assert.equal(shouldRestoreIdentity("a","a","INITIAL_SESSION"),true);
  assert.equal(shouldRestoreIdentity("a",null,"SIGNED_OUT"),true);
});
