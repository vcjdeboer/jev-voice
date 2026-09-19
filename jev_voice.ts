/**
 * @vcjdeboer/jev-voice — Multi-dimensional writing voice profiler powered by Jev.
 *
 * Feed any text (articles, READMEs, docs, papers, commit messages) and get a
 * calibrated voice profile across six dimensions: formality, authority,
 * complexity, warmth, pace, and confidence. Each dimension is a Jev score with
 * probabilities across the full spectrum — a text that's 60% formal and 40%
 * conversational IS the profile, not a rounding error.
 *
 * Methods:
 * - **profile** — full 6-dimension voice profile of a text
 * - **compare** — profile two texts and highlight voice differences
 *
 * @module
 */
import { z } from "npm:zod@4";

const API_KEY_ENV = "TYPESAFE_API_KEY";
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

// ---------------------------------------------------------------------------
// Global arguments
// ---------------------------------------------------------------------------

/** Extension configuration: TypeSafe API key and model settings. */
const GlobalArgsSchema = z.object({
  apiKey: z.string().min(1).meta({ sensitive: true }).optional().describe(
    "TypeSafe API key. Prefer a vault reference: " +
      '${{ vault.get("<vault>", "TYPESAFE_API_KEY") }}. ' +
      `Falls back to the ${API_KEY_ENV} env var when omitted.`,
  ),
  model: z.string().min(1).default(DEFAULT_MODEL).describe(
    "System One model. Defaults to jev-latest.",
  ),
  baseUrl: z.string().url().default(DEFAULT_BASE_URL).describe(
    "API root. Change only for a proxy or test server.",
  ),
  timeoutMs: z.number().int().positive().default(30_000).describe(
    "Per-attempt HTTP timeout in milliseconds.",
  ),
  maxRetries: z.number().int().min(0).max(10).default(2).describe(
    "Retries after the first attempt on 408/429/5xx.",
  ),
});

type GlobalArgs = z.infer<typeof GlobalArgsSchema>;

// ---------------------------------------------------------------------------
// Voice dimension definitions
// ---------------------------------------------------------------------------

const DIMENSIONS = {
  formality: {
    type: "score" as const,
    instructions:
      "Rate the formality of this writing. Consider word choice, sentence " +
      "structure, contractions, colloquialisms, and register. Academic papers " +
      "and legal text sit at the formal end; blog posts, tweets, and casual " +
      "chat sit at the informal end. Technical documentation lands in between.",
    criteria: [
      "Casual — contractions, slang, first person, conversational asides, " +
      "reads like talking to a friend",
      "Relaxed — readable and approachable, some informality but structured, " +
      "typical of good blog posts and dev docs",
      "Professional — clean, structured prose, avoids slang but not stiff, " +
      "typical of business writing and polished READMEs",
      "Formal — precise diction, complex sentences, passive voice acceptable, " +
      "typical of academic papers and official documentation",
    ],
  },
  authority: {
    type: "score" as const,
    instructions:
      "Rate how much authority and conviction the writing projects. " +
      "Authoritative writing states positions directly, uses imperative voice, " +
      "and presents claims without excessive hedging. Tentative writing " +
      "qualifies everything, uses 'might', 'perhaps', 'it seems', and avoids " +
      "strong claims. Neither is better — the right level depends on context.",
    criteria: [
      "Tentative — heavy hedging, frequent qualifiers, avoids taking positions, " +
      "lots of 'might', 'could', 'it seems'",
      "Balanced — states opinions but acknowledges alternatives, measured " +
      "confidence, typical of thoughtful analysis",
      "Confident — clear positions with supporting reasoning, minimal hedging, " +
      "willing to make strong claims when warranted",
      "Commanding — direct, imperative, prescriptive, tells you what to do " +
      "and why, manifesto-like conviction",
    ],
  },
  complexity: {
    type: "score" as const,
    instructions:
      "Rate the intellectual complexity and density of this writing. " +
      "Consider vocabulary level, assumed background knowledge, abstraction " +
      "depth, and information density per sentence. A children's explanation " +
      "of gravity is simple; a physics paper on gravitational waves is dense. " +
      "Code examples and jargon increase complexity for outsiders but may be " +
      "appropriate for the target audience.",
    criteria: [
      "Accessible — plain language, short sentences, no assumed expertise, " +
      "a newcomer can follow without background",
      "Moderate — some domain terms explained inline, builds on basic " +
      "knowledge, typical of introductory technical writing",
      "Technical — assumes domain familiarity, uses jargon without " +
      "definition, multiple concepts per paragraph",
      "Dense — high abstraction, layered arguments, requires deep expertise, " +
      "information-packed sentences",
    ],
  },
  warmth: {
    type: "score" as const,
    instructions:
      "Rate the human warmth and approachability of this writing. Warm " +
      "writing acknowledges the reader, uses inclusive language ('we', 'you'), " +
      "shares personal experience, and shows empathy. Clinical writing is " +
      "detached, objective, impersonal — it could be written by anyone or " +
      "no one. Both have their place.",
    criteria: [
      "Clinical — impersonal, detached, no 'I' or 'we', reads like a " +
      "specification or legal document",
      "Neutral — professional but not cold, occasional 'you' or 'we', " +
      "focused on the subject not the reader",
      "Engaging — addresses the reader directly, shares perspective, some " +
      "personality shows through, relatable",
      "Personal — first person, anecdotes, humor, vulnerability, strong " +
      "authorial voice, reads like a conversation",
    ],
  },
  pace: {
    type: "score" as const,
    instructions:
      "Rate the pace of this writing — how quickly it moves through ideas. " +
      "Fast-paced writing is punchy: short sentences, quick transitions, " +
      "jumps between points. Slow-paced writing is deliberate: builds " +
      "arguments step by step, lingers on details, unpacks implications. " +
      "Consider sentence length variation, paragraph density, and how much " +
      "ground is covered per section.",
    criteria: [
      "Deliberate — slow build, thorough explanations, unpacks every " +
      "implication, takes its time",
      "Measured — steady progression, balanced between depth and momentum, " +
      "typical of well-structured articles",
      "Brisk — efficient, moves quickly between points, doesn't linger, " +
      "expects the reader to keep up",
      "Rapid — punchy, terse, high density of ideas per paragraph, " +
      "almost breathless momentum",
    ],
  },
  conviction: {
    type: "score" as const,
    instructions:
      "Rate the strength of opinion and stance in this writing. Does the " +
      "author have a clear thesis or point of view, or is it neutral " +
      "reporting? Opinionated writing argues for something — it has a " +
      "message. Neutral writing presents information without advocating. " +
      "Consider: could you summarize the author's position in one sentence?",
    criteria: [
      "Neutral — presents facts and options without taking sides, " +
      "informational, reference-style",
      "Leaning — has a viewpoint but presents it gently, 'here's what I " +
      "found' rather than 'here's what you should do'",
      "Opinionated — clear thesis, argues a position, marshals evidence " +
      "for a conclusion",
      "Polemical — strong stance, challenges orthodoxy, provocative, " +
      "designed to change minds",
    ],
  },
};

type DimensionName = keyof typeof DIMENSIONS;
const DIMENSION_NAMES = Object.keys(DIMENSIONS) as DimensionName[];

// ---------------------------------------------------------------------------
// Result schemas
// ---------------------------------------------------------------------------

const DimensionResultSchema = z.object({
  score: z.number(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

const VoiceProfileSchema = z.object({
  formality: DimensionResultSchema,
  authority: DimensionResultSchema,
  complexity: DimensionResultSchema,
  warmth: DimensionResultSchema,
  pace: DimensionResultSchema,
  conviction: DimensionResultSchema,
  textLength: z.number(),
  textPreview: z.string(),
  model: z.string(),
  evaluatedAt: z.iso.datetime(),
});

const CompareResultSchema = z.object({
  a: VoiceProfileSchema.omit({ model: true, evaluatedAt: true }),
  b: VoiceProfileSchema.omit({ model: true, evaluatedAt: true }),
  deltas: z.object({
    formality: z.number(),
    authority: z.number(),
    complexity: z.number(),
    warmth: z.number(),
    pace: z.number(),
    conviction: z.number(),
  }),
  model: z.string(),
  evaluatedAt: z.iso.datetime(),
});

// ---------------------------------------------------------------------------
// Jev API client (inlined)
// ---------------------------------------------------------------------------

function resolveApiKey(ga: Pick<GlobalArgs, "apiKey">): string {
  const key = ga.apiKey ?? (() => {
    try {
      const v = Deno.env.get(API_KEY_ENV);
      return v?.trim() || undefined;
    } catch {
      return undefined;
    }
  })();
  if (!key) {
    throw new Error(
      `No TypeSafe API key. Set apiKey global argument ` +
        `(vault ref preferred) or export ${API_KEY_ENV}.`,
    );
  }
  return key;
}

interface JevQuestion {
  type: "noul" | "choice" | "score";
  instructions: string;
  criteria?: unknown;
}

interface JevAnswer {
  type: string;
  score?: number;
  legend?: Record<string, unknown>;
  probabilities?: Record<string, number>;
  confidence?: number;
}

interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
}

async function callJev(
  ga: GlobalArgs,
  state: unknown,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
): Promise<JevResponse> {
  const apiKey = resolveApiKey(ga);
  const model = ga.model ?? DEFAULT_MODEL;
  const baseUrl = (ga.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const maxRetries = ga.maxRetries ?? 2;
  const timeoutMs = ga.timeoutMs ?? 30_000;

  for (let attempt = 0;; attempt++) {
    signal?.throwIfAborted();
    const ac = AbortSignal.timeout(timeoutMs);
    const sig = signal ? AbortSignal.any([signal, ac]) : ac;

    let resp: Response;
    try {
      resp = await fetch(`${baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "jev-voice/1",
        },
        body: JSON.stringify({ state, model, questions }),
        signal: sig,
      });
    } catch (err) {
      if (signal?.aborted) throw signal.reason;
      if (attempt >= maxRetries) {
        throw new Error(
          `TypeSafe API unreachable after ${attempt + 1} attempts: ${err}`,
        );
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }

    if (resp.ok) return await resp.json() as JevResponse;

    if (attempt >= maxRetries || !RETRYABLE.has(resp.status)) {
      const body = await resp.text().catch(() => "");
      throw new Error(
        `TypeSafe API returned ${resp.status}: ${body.slice(0, 500)}`,
      );
    }
    const ra = resp.headers.get("retry-after");
    const delay = ra
      ? Math.min(Number(ra) * 1000 || 500, 60_000)
      : 500 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, delay));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildQuestions(): Record<string, JevQuestion> {
  const qs: Record<string, JevQuestion> = {};
  for (const [name, dim] of Object.entries(DIMENSIONS)) {
    qs[name] = {
      type: dim.type,
      instructions: dim.instructions,
      criteria: dim.criteria,
    };
  }
  return qs;
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

// ---------------------------------------------------------------------------
// Method context type
// ---------------------------------------------------------------------------

interface MethodContext {
  globalArgs: GlobalArgs;
  logger: {
    info: (msg: string, props?: Record<string, unknown>) => void;
  };
  signal?: AbortSignal;
  writeResource: (
    specName: string,
    name: string,
    data: Record<string, unknown>,
  ) => Promise<{ name: string }>;
}

// ---------------------------------------------------------------------------
// Method argument schemas
// ---------------------------------------------------------------------------

const NameSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, {
    message: "name must be lowercase alphanumeric with hyphens/underscores",
  })
  .default("latest")
  .describe("Resource instance name.");

const TextInput = z.string().min(50).describe(
  "The text to analyze. Minimum 50 characters for meaningful profiling.",
);

const ProfileArgsSchema = z.object({
  text: TextInput,
  label: z.string().optional().default("").describe(
    "Optional label for the text (e.g. article title, author name).",
  ),
  name: NameSchema,
});

const ProfileUrlArgsSchema = z.object({
  url: z.string().url().describe(
    "URL of the article to fetch and profile.",
  ),
  label: z.string().optional().default("").describe(
    "Optional label for the text (e.g. article title, author name).",
  ),
  name: NameSchema,
  maxChars: z.number().int().positive().default(12_000).describe(
    "Maximum characters to extract from the page. Truncates to this length.",
  ),
});

const CompareArgsSchema = z.object({
  textA: TextInput.describe("First text to compare."),
  textB: TextInput.describe("Second text to compare."),
  labelA: z.string().optional().default("A").describe("Label for text A."),
  labelB: z.string().optional().default("B").describe("Label for text B."),
  name: NameSchema,
});

// ---------------------------------------------------------------------------
// HTML text extraction
// ---------------------------------------------------------------------------

const STRIP_TAGS = new Set([
  "script", "style", "svg", "nav", "footer", "header", "noscript",
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

async function fetchText(
  url: string,
  maxChars: number,
  signal?: AbortSignal,
): Promise<string> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; jev-voice/1; +https://swamp.club)",
    },
    signal: signal ?? AbortSignal.timeout(30_000),
    redirect: "follow",
  });
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  }
  const html = await resp.text();
  const text = stripHtml(html);
  if (text.length < 50) {
    throw new Error(
      `Extracted text too short (${text.length} chars) from ${url}`,
    );
  }
  return text.slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// Model definition
// ---------------------------------------------------------------------------

/** Swamp model: multi-dimensional writing voice profiler powered by Jev. */
export const model = {
  type: "@vcjdeboer/jev-voice",
  version: "2026.09.19.3",
  globalArguments: GlobalArgsSchema,
  upgrades: [],
  reports: ["@vcjdeboer/voice-comparison"],
  resources: {
    profile: {
      description: "Voice profile — 6 dimensions with scores and probabilities",
      schema: VoiceProfileSchema,
      lifetime: "infinite",
      garbageCollection: 100,
    },
    comparison: {
      description: "Side-by-side voice comparison of two texts",
      schema: CompareResultSchema,
      lifetime: "infinite",
      garbageCollection: 50,
    },
  },
  checks: {
    "api-key-configured": {
      description: "Ensure a TypeSafe API key is available",
      labels: ["policy"],
      execute: async (context: { globalArgs: GlobalArgs }) => {
        try {
          resolveApiKey(context.globalArgs);
          return await Promise.resolve({ pass: true });
        } catch (err) {
          return { pass: false, errors: [(err as Error).message] };
        }
      },
    },
  },
  methods: {
    profile: {
      description:
        "Analyze writing voice across 6 dimensions: formality, authority, " +
        "complexity, warmth, pace, conviction. Returns calibrated scores " +
        "with probabilities.",
      arguments: ProfileArgsSchema,
      execute: async (
        args: z.infer<typeof ProfileArgsSchema>,
        context: MethodContext,
      ) => {
        const label = args.label || args.name;
        context.logger.info("Profiling voice for {label} ({len} chars)", {
          label,
          len: args.text.length,
        });
        const state = {
          text: args.text,
          task: "Analyze the writing voice and style of this text.",
        };
        const resp = await callJev(
          context.globalArgs,
          state,
          buildQuestions(),
          context.signal,
        );
        const profile = extractProfile(resp.answers, args.text);
        const handle = await context.writeResource(
          "profile",
          `profile-${args.name}`,
          {
            ...profile,
            model: resp.model,
            evaluatedAt: new Date().toISOString(),
          },
        );
        const scores = DIMENSION_NAMES.map((d) =>
          `${d}=${(resp.answers[d]?.score ?? 0).toFixed(1)}`
        ).join(" ");
        context.logger.info("Voice: {scores}", { scores });
        return { dataHandles: [handle] };
      },
    },
    profile_url: {
      description:
        "Fetch a URL, extract readable text, and profile its writing voice " +
        "across 6 dimensions. Handles HTML stripping automatically.",
      arguments: ProfileUrlArgsSchema,
      execute: async (
        args: z.infer<typeof ProfileUrlArgsSchema>,
        context: MethodContext,
      ) => {
        const label = args.label || args.name;
        context.logger.info("Fetching {url} for {label}", {
          url: args.url,
          label,
        });
        const text = await fetchText(
          args.url,
          args.maxChars,
          context.signal,
        );
        context.logger.info("Extracted {len} chars, profiling...", {
          len: text.length,
        });
        const state = {
          text,
          task: "Analyze the writing voice and style of this text.",
        };
        const resp = await callJev(
          context.globalArgs,
          state,
          buildQuestions(),
          context.signal,
        );
        const profile = extractProfile(resp.answers, text);
        const handle = await context.writeResource(
          "profile",
          `profile-${args.name}`,
          {
            ...profile,
            model: resp.model,
            evaluatedAt: new Date().toISOString(),
          },
        );
        const scores = DIMENSION_NAMES.map((d) =>
          `${d}=${(resp.answers[d]?.score ?? 0).toFixed(1)}`
        ).join(" ");
        context.logger.info("Voice: {scores}", { scores });
        return { dataHandles: [handle] };
      },
    },
    refresh_report: {
      description:
        "No-op method that triggers the voice-comparison report. " +
        "Use as the final workflow step after a forEach profile batch " +
        "to produce a clean, unvariant aggregate report.",
      arguments: z.object({}),
      execute: async (
        _args: Record<string, never>,
        context: MethodContext,
      ) => {
        context.logger.info("Report refresh triggered");
        return { dataHandles: [] };
      },
    },
    compare: {
      description: "Profile two texts side by side and show the voice delta " +
        "across all 6 dimensions",
      arguments: CompareArgsSchema,
      execute: async (
        args: z.infer<typeof CompareArgsSchema>,
        context: MethodContext,
      ) => {
        context.logger.info(
          "Comparing voice: {a} vs {b}",
          { a: args.labelA, b: args.labelB },
        );
        // Profile A
        const stateA = {
          text: args.textA,
          task: "Analyze the writing voice and style of this text.",
        };
        const respA = await callJev(
          context.globalArgs,
          stateA,
          buildQuestions(),
          context.signal,
        );
        // Profile B
        const stateB = {
          text: args.textB,
          task: "Analyze the writing voice and style of this text.",
        };
        const respB = await callJev(
          context.globalArgs,
          stateB,
          buildQuestions(),
          context.signal,
        );

        const profileA = extractProfile(respA.answers, args.textA);
        const profileB = extractProfile(respB.answers, args.textB);
        const deltas: Record<string, number> = {};
        for (const d of DIMENSION_NAMES) {
          deltas[d] = (respB.answers[d]?.score ?? 0) -
            (respA.answers[d]?.score ?? 0);
        }

        const handle = await context.writeResource(
          "comparison",
          `comparison-${args.name}`,
          {
            a: profileA,
            b: profileB,
            deltas,
            model: respA.model,
            evaluatedAt: new Date().toISOString(),
          },
        );
        const deltaStr = DIMENSION_NAMES.map((d) => {
          const v = deltas[d];
          return `${d}=${v > 0 ? "+" : ""}${v.toFixed(1)}`;
        }).join(" ");
        context.logger.info("Deltas (B-A): {deltaStr}", { deltaStr });
        return { dataHandles: [handle] };
      },
    },
  },
};
