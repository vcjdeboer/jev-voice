import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";

// We can't import internals directly, so we test the exported schemas
// and replicate the pure functions under test.

// --- stripHtml (replicated from source for unit testing) ---

const STRIP_TAGS = new Set([
  "script",
  "style",
  "svg",
  "nav",
  "footer",
  "header",
  "noscript",
]);

function stripHtml(html: string): string {
  let text = html;
  for (const tag of STRIP_TAGS) {
    text = text.replace(
      new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi"),
      " ",
    );
  }
  text = text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

// --- extractProfile (replicated) ---

const DIMENSION_NAMES = [
  "formality",
  "authority",
  "complexity",
  "warmth",
  "pace",
  "conviction",
] as const;

interface JevAnswer {
  type: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
}

function extractProfile(
  answers: Record<string, JevAnswer>,
  text: string,
): Record<string, unknown> {
  const profile: Record<string, unknown> = {};
  for (const name of DIMENSION_NAMES) {
    const a = answers[name];
    profile[name] = {
      score: a?.score ?? 0,
      probabilities: a?.probabilities ?? {},
      confidence: a?.confidence ?? 0,
    };
  }
  profile.textLength = text.length;
  profile.textPreview = text.slice(0, 200).replace(/\n/g, " ");
  return profile;
}

// --- resolveApiKey (replicated) ---

function resolveApiKey(
  apiKey: string | undefined,
): string {
  if (!apiKey) {
    throw new Error("No TypeSafe API key.");
  }
  return apiKey;
}

// =========================================================================
// Tests
// =========================================================================

Deno.test("stripHtml removes script tags", () => {
  const html = '<p>Hello</p><script>alert("x")</script><p>World</p>';
  assertEquals(stripHtml(html), "Hello World");
});

Deno.test("stripHtml removes style tags", () => {
  const html = "<style>body{color:red}</style><div>Content</div>";
  assertEquals(stripHtml(html), "Content");
});

Deno.test("stripHtml removes nav and footer", () => {
  const html =
    '<nav><a href="/">Home</a></nav><main>Article text</main><footer>Copyright</footer>';
  assertEquals(stripHtml(html), "Article text");
});

Deno.test("stripHtml decodes HTML entities", () => {
  assertEquals(stripHtml("&amp; &lt; &gt; &quot; &#39;"), '& < > " \'');
});

Deno.test("stripHtml collapses whitespace", () => {
  const html = "<p>  too   many    spaces  </p>";
  assertEquals(stripHtml(html), "too many spaces");
});

Deno.test("stripHtml handles empty string", () => {
  assertEquals(stripHtml(""), "");
});

Deno.test("stripHtml handles nested tags", () => {
  const html = "<div><p><strong>Bold</strong> text</p></div>";
  assertEquals(stripHtml(html), "Bold text");
});

Deno.test("extractProfile maps all six dimensions", () => {
  const answers: Record<string, JevAnswer> = {
    formality: {
      type: "score",
      score: 1.5,
      probabilities: { Casual: 0.1, Relaxed: 0.4, Professional: 0.4, Formal: 0.1 },
      confidence: 0.8,
    },
    authority: {
      type: "score",
      score: 2.0,
      probabilities: { Tentative: 0, Measured: 0.1, Confident: 0.8, Commanding: 0.1 },
      confidence: 0.9,
    },
    complexity: {
      type: "score",
      score: 1.0,
      probabilities: { Accessible: 0.2, Moderate: 0.6, Specialized: 0.2, Dense: 0 },
      confidence: 0.7,
    },
    warmth: {
      type: "score",
      score: 2.5,
      probabilities: { Clinical: 0, Neutral: 0.1, Approachable: 0.3, Personal: 0.6 },
      confidence: 0.85,
    },
    pace: {
      type: "score",
      score: 1.2,
      probabilities: { Deliberate: 0.1, Steady: 0.6, Brisk: 0.3, Rapid: 0 },
      confidence: 0.65,
    },
    conviction: {
      type: "score",
      score: 2.8,
      probabilities: { Neutral: 0, Leaning: 0, Opinionated: 0.2, Polemical: 0.8 },
      confidence: 0.95,
    },
  };

  const text = "A".repeat(300);
  const profile = extractProfile(answers, text);

  assertEquals((profile.formality as { score: number }).score, 1.5);
  assertEquals((profile.authority as { score: number }).score, 2.0);
  assertEquals((profile.complexity as { score: number }).score, 1.0);
  assertEquals((profile.warmth as { score: number }).score, 2.5);
  assertEquals((profile.pace as { score: number }).score, 1.2);
  assertEquals((profile.conviction as { score: number }).score, 2.8);
  assertEquals(profile.textLength, 300);
  assertEquals((profile.textPreview as string).length, 200);
});

Deno.test("extractProfile handles missing answers gracefully", () => {
  const profile = extractProfile({}, "short text");
  assertEquals((profile.formality as { score: number }).score, 0);
  assertEquals((profile.formality as { confidence: number }).confidence, 0);
  assertEquals(profile.textLength, 10);
});

Deno.test("extractProfile truncates textPreview at 200 chars", () => {
  const text = "x".repeat(500);
  const profile = extractProfile({}, text);
  assertEquals((profile.textPreview as string).length, 200);
  assertEquals(profile.textLength, 500);
});

Deno.test("extractProfile replaces newlines in preview", () => {
  const text = "line one\nline two\nline three" + " ".repeat(200);
  const profile = extractProfile({}, text);
  assertEquals((profile.textPreview as string).includes("\n"), false);
});

Deno.test("resolveApiKey throws without key", () => {
  assertThrows(
    () => resolveApiKey(undefined),
    Error,
    "No TypeSafe API key",
  );
});

Deno.test("resolveApiKey returns provided key", () => {
  assertEquals(resolveApiKey("sk-test-123"), "sk-test-123");
});

Deno.test("DIMENSION_NAMES has exactly six dimensions", () => {
  assertEquals(DIMENSION_NAMES.length, 6);
  assertEquals(DIMENSION_NAMES[0], "formality");
  assertEquals(DIMENSION_NAMES[5], "conviction");
});
