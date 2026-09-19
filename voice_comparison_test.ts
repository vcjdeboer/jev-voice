import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Replicate pure functions from the report for unit testing.

const DIMS = [
  "formality",
  "authority",
  "complexity",
  "warmth",
  "pace",
  "conviction",
] as const;

type Dim = (typeof DIMS)[number];

const LEVELS: Record<Dim, [string, string, string, string]> = {
  formality: ["Casual", "Relaxed", "Professional", "Formal"],
  authority: ["Tentative", "Measured", "Confident", "Commanding"],
  complexity: ["Accessible", "Moderate", "Specialized", "Dense"],
  warmth: ["Clinical", "Neutral", "Approachable", "Personal"],
  pace: ["Deliberate", "Steady", "Brisk", "Rapid"],
  conviction: ["Neutral", "Leaning", "Opinionated", "Polemical"],
};

interface DimResult {
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
}

function dominantLevel(dim: Dim, d: DimResult): string {
  const probs = d.probabilities;
  let maxP = -1;
  let maxI = 0;
  for (let i = 0; i < 4; i++) {
    const p = probs[String(i)] ?? 0;
    if (p > maxP) {
      maxP = p;
      maxI = i;
    }
  }
  return LEVELS[dim][maxI];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

const EXCLUDE = new Set(["profile-test-trigger", "profile-report-trigger"]);

function shouldInclude(name: string, specName: string | undefined): boolean {
  return specName === "profile" &&
    name.startsWith("profile-") &&
    !EXCLUDE.has(name);
}

// =========================================================================
// Tests
// =========================================================================

Deno.test("dominantLevel picks highest probability", () => {
  const d: DimResult = {
    score: 1.5,
    probabilities: { "0": 0.1, "1": 0.6, "2": 0.2, "3": 0.1 },
    confidence: 0.8,
  };
  assertEquals(dominantLevel("formality", d), "Relaxed");
});

Deno.test("dominantLevel handles commanding authority", () => {
  const d: DimResult = {
    score: 3,
    probabilities: { "0": 0, "1": 0, "2": 0.05, "3": 0.95 },
    confidence: 0.95,
  };
  assertEquals(dominantLevel("authority", d), "Commanding");
});

Deno.test("dominantLevel handles tie (picks first)", () => {
  const d: DimResult = {
    score: 1,
    probabilities: { "0": 0.5, "1": 0.5, "2": 0, "3": 0 },
    confidence: 0.5,
  };
  // With equal probabilities, first one wins (index 0)
  assertEquals(dominantLevel("warmth", d), "Clinical");
});

Deno.test("dominantLevel handles missing probabilities", () => {
  const d: DimResult = {
    score: 0,
    probabilities: {},
    confidence: 0,
  };
  assertEquals(dominantLevel("pace", d), "Deliberate");
});

Deno.test("pct formats correctly", () => {
  assertEquals(pct(0.5), "50%");
  assertEquals(pct(0.123), "12%");
  assertEquals(pct(1), "100%");
  assertEquals(pct(0), "0%");
});

Deno.test("EXCLUDE set filters test entries", () => {
  assertEquals(shouldInclude("profile-test-trigger", "profile"), false);
  assertEquals(shouldInclude("profile-report-trigger", "profile"), false);
  assertEquals(shouldInclude("profile-watson-vibe", "profile"), true);
});

Deno.test("shouldInclude rejects non-profile specs", () => {
  assertEquals(shouldInclude("profile-watson-vibe", "compare"), false);
  assertEquals(shouldInclude("profile-watson-vibe", undefined), false);
});

Deno.test("shouldInclude rejects non-profile names", () => {
  assertEquals(shouldInclude("compare-result", "profile"), false);
});

Deno.test("LEVELS has four entries per dimension", () => {
  for (const dim of DIMS) {
    assertEquals(LEVELS[dim].length, 4, `${dim} should have 4 levels`);
  }
});

Deno.test("DIMS has exactly six dimensions", () => {
  assertEquals(DIMS.length, 6);
});

Deno.test("rankings: euclidean distance from centroid", () => {
  const profiles = [
    { formality: 1, authority: 2, complexity: 2, warmth: 3, pace: 1, conviction: 2 },
    { formality: 2, authority: 3, complexity: 3, warmth: 1, pace: 3, conviction: 3 },
  ];
  const means = DIMS.map((d) =>
    profiles.reduce((s, p) => s + (p as Record<string, number>)[d], 0) /
    profiles.length
  );
  assertEquals(means[0], 1.5); // formality mean
  assertEquals(means[3], 2); // warmth mean

  const dist0 = Math.sqrt(
    DIMS.reduce(
      (s, d, i) =>
        s + ((profiles[0] as Record<string, number>)[d] - means[i]) ** 2,
      0,
    ),
  );
  const dist1 = Math.sqrt(
    DIMS.reduce(
      (s, d, i) =>
        s + ((profiles[1] as Record<string, number>)[d] - means[i]) ** 2,
      0,
    ),
  );
  // Both profiles are equidistant from centroid (mirror image)
  assertEquals(Math.round(dist0 * 100), Math.round(dist1 * 100));
});
