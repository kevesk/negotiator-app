export type Direction = "higher_better" | "lower_better";
export interface Issue { id: string; weight: number; kind: "numeric" | "rated"; direction?: Direction; walkAwayLevel?: number }
/** For numeric issues the value is the amount; for rated issues it is 0 to 100. */
export interface Pkg { id: string; values: Record<string, number> }
export interface ScoredPackage { id: string; score: number; contributions: Record<string, number>; tieGroup: number }
export interface ScoreResult {
  ranking: ScoredPackage[]; removed: { id: string; issue: string }[]; needs?: string[]; error?: string;
}
/** Default points for ranked-only issues (RULE-058). Five or more need the user to share points. */
export function liteWeights(n: number): number[] | undefined {
  if (n === 3) return [61, 28, 11];
  if (n === 4) return [52, 27, 15, 6];
  return undefined;
}
const r1 = (x: number) => Math.round(x * 10) / 10;
export function scorePackages(issues: Issue[], pkgs: Pkg[]): ScoreResult {
  if (issues.length === 0 || issues.length > 6) return { ranking: [], removed: [], error: "issues_count" };
  if (issues.reduce((a, i) => a + i.weight, 0) !== 100) return { ranking: [], removed: [], error: "weights_sum_100" };
  const best: Record<string, number> = {};
  for (const is of issues) if (is.kind === "numeric") {
    const vals = pkgs.map((p) => p.values[is.id]).filter((v): v is number => v !== undefined);
    best[is.id] = is.direction === "lower_better" ? Math.min(...vals) : Math.max(...vals);
  }
  const removed: ScoreResult["removed"] = []; const scored: Omit<ScoredPackage, "tieGroup">[] = [];
  for (const p of pkgs) {
    let out: string | undefined; const contributions: Record<string, number> = {};
    let total = 0;
    for (const is of issues) {
      const x = p.values[is.id];
      if (x === undefined) return { ranking: [], removed: [], needs: [`${p.id}.${is.id}`] };
      let rating = x;
      if (is.kind === "numeric") {
        const w = is.walkAwayLevel!; const b = best[is.id]!; const up = is.direction !== "lower_better";
        if (up ? x < w : x > w) { out = is.id; break; }
        rating = b === w ? 100 : (100 * (x - w)) / (b - w);
      }
      contributions[is.id] = r1((is.weight * rating) / 100);
      total += (is.weight * rating) / 100;
    }
    if (out) removed.push({ id: p.id, issue: out }); else scored.push({ id: p.id, score: r1(total), contributions });
  }
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  let group = -1, top = Infinity;
  const ranking = scored.map((s) => { if (top - s.score > 5) { group++; top = s.score; } return { ...s, tieGroup: group }; });
  return { ranking, removed };
}
