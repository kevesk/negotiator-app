const STOP = new Set(("a an and are as at be but by for from has have how i if in into is it its me my of on or our so that the their them then there these they this to was we what when which who will with you your " +
  "och att det som en ett är på för med av om till jag vi du de den har kan ska inte men eller så").split(" "));
/** Lowercase unicode tokens, stop words removed, light plural stemming. Keeps åäö. */
export function tokenize(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.toLocaleLowerCase("sv-SE").match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOP.has(raw) || raw.length < 2) continue;
    out.push(stem(raw));
  }
  return out;
}
export function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}
/** Raw lowercase words (no stemming, no stop words) for alias matching. */
export const words = (s: string): string[] => s.toLocaleLowerCase("sv-SE").match(/[\p{L}\p{N}]+/gu) ?? [];
