import { it } from "vitest";
import { checkRetrieval } from "./retrieval-check";
it("retrieval check (report only)", () => {
  const rows = checkRetrieval(); const hits = rows.filter((r) => r.hit);
  for (const r of rows) process.stdout.write(`RC ${r.id} ${r.hit ? `hit at ${r.rank}` : "MISS"}${r.hit ? "" : ` (got: ${r.top.join(", ")})`}\n`);
  process.stdout.write(`RC TOTAL ${hits.length}/${rows.length} found; ${rows.filter((r) => r.rank === 1).length} ranked first\n`);
});
