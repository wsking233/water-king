import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";

function buildId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "local";
  }
}

export default defineConfig(({ command }) => ({
  define: {
    __APP_BUILD__: JSON.stringify(command === "serve" ? "本地开发" : buildId()),
  },
}));
