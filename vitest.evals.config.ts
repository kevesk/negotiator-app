import { defineConfig } from "vitest/config";
import path from "node:path";
// Live evals: run with `npm run evals` (needs ANTHROPIC_API_KEY). Separate from the normal tests so CI never spends money.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: [process.env.EVAL_FILE ?? "evals/run.eval.ts"], testTimeout: 3_600_000, hookTimeout: 3_600_000 },
});
