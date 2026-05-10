// Simple word-level diff using Myers-ish LCS for review highlighting.
import { tokenize, normalizeArabic } from "./normalize";

export type DiffOp = { type: "equal" | "insert" | "delete" | "replace"; ref?: string; hyp?: string };

export function wordDiff(refText: string, hypText: string): DiffOp[] {
  const ref = tokenize(normalizeArabic(refText));
  const hyp = tokenize(normalizeArabic(hypText));
  const m = ref.length;
  const n = hyp.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        ref[i - 1] === hyp[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      ops.push({ type: "equal", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ type: "replace", ref: ref[i - 1], hyp: hyp[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j] === dp[i][j - 1] + 1)) {
      ops.push({ type: "insert", hyp: hyp[j - 1] });
      j--;
    } else {
      ops.push({ type: "delete", ref: ref[i - 1] });
      i--;
    }
  }
  return ops.reverse();
}
