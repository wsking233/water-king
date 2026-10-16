import test from "node:test";
import assert from "node:assert/strict";
import { requestBinding, confirmBinding, setAccountPassword, loginWithPassword, requestPasswordRecovery, confirmPasswordRecovery, emailAuthMessage } from "../src/cloud/emailAuth.ts";

function fixture(user: any = { id: "guest", is_anonymous: true }) {
  const calls: any[] = [];
  const auth = {
    getUser: async () => ({ data: { user }, error: null }),
    updateUser: async (input: any) => { calls.push(input); return { data: { user }, error: null }; },
    verifyOtp: async (input: any) => { calls.push(input); return { data: { user: { ...user, is_anonymous: false, email_confirmed_at: "verified" } }, error: null }; },
    signInWithPassword: async (input: any) => { calls.push(input); return { data: { user: { id: "bound", is_anonymous: false } }, error: null }; },
    resetPasswordForEmail: async (email: string) => { calls.push(email); return { error: null }; },
  };
  return { client: { auth } as any, calls, auth };
}
test("binding updates the current guest rather than signing up; verifies email_change and preserves ID", async () => {
  const { client, calls } = fixture();
  await requestBinding(client, "guest", " user@example.com ", async () => client);
  const bound = await confirmBinding(client, "guest", "user@example.com", " 123456 ");
  assert.equal(bound.id, "guest");
  assert.deepEqual(calls, [{ email: "user@example.com" }, { email: "user@example.com", token: "123456", type: "email_change" }]);
});
test("changed identity and unverified guests cannot set a password or mutate another account", async () => {
  const { client, calls } = fixture();
  await assert.rejects(requestBinding(client, "other", "x@example.com", async () => client), /账号已变化/);
  await assert.rejects(setAccountPassword(client, "guest", "secret", async () => client), /请先完成/);
  assert.deepEqual(calls, []);
});
test("binding failures and mismatched verification IDs never proceed to password setting", async () => {
  const f = fixture();
  f.auth.verifyOtp = async () => ({ data: { user: { id: "other", is_anonymous: false, email_confirmed_at: "verified" } }, error: null });
  await assert.rejects(confirmBinding(f.client, "guest", "a@example.com", "123456"), /邮箱验证尚未完成/);
  const failure = { code: "email_exists" };
  f.auth.updateUser = async () => { throw failure; };
  await assert.rejects(requestBinding(f.client, "guest", "a@example.com", async () => f.client), e => e === failure);
  assert.deepEqual(f.calls, []);
});
test("password login, recovery verification and password updates use distinct Auth operations", async () => {
  const f = fixture({ id: "bound", is_anonymous: false, email_confirmed_at: "verified" });
  assert.equal((await loginWithPassword(f.client, " a@example.com ", "secret")).id, "bound");
  await requestPasswordRecovery(f.client, " a@example.com ");
  await confirmPasswordRecovery(f.client, "a@example.com", "654321");
  await setAccountPassword(f.client, "bound", "new-secret", async () => f.client);
  assert.deepEqual(f.calls, [{ email: "a@example.com", password: "secret" }, "a@example.com", { email: "a@example.com", token: "654321", type: "recovery" }, { password: "new-secret" }]);
});
test("errors do not render raw server messages or expose account secrets", () => {
  assert.match(emailAuthMessage({ code: "email_exists" }), /不会自动合并/);
  assert.match(emailAuthMessage({ code: "invalid_credentials" }), /邮箱或密码/);
  assert.doesNotMatch(emailAuthMessage(Error("secret token")), /secret token/);
});
