import test from "node:test";
import assert from "node:assert/strict";
import { cloudConfig } from "../src/cloud/config.ts";

test("cloud setup is optional but partial and privileged configs fail closed", () => {
  assert.equal(cloudConfig(undefined, undefined), null);
  assert.throws(() => cloudConfig("https://example.supabase.co", undefined));
  assert.throws(() => cloudConfig(undefined, "sb_publishable_public"));
  assert.throws(() => cloudConfig("https://example.supabase.co", "sb_secret_private"));
  assert.throws(() => cloudConfig("https://example.supabase.co", "eyJ.service.role"));
  assert.throws(() => cloudConfig("http://example.supabase.co", "sb_publishable_public"));
  assert.throws(() => cloudConfig("https://example.supabase.co/path", "sb_publishable_public"));
  assert.throws(() => cloudConfig("https://user:password@example.supabase.co", "sb_publishable_public"));
  assert.deepEqual(cloudConfig("https://example.supabase.co", "sb_publishable_public"), {
    url: "https://example.supabase.co", key: "sb_publishable_public",
  });
});
