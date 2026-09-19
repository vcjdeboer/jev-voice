/**
 * @vcjdeboer/voice-comparison — deterministic voice comparison report.
 *
 * Model-scope report that reads ALL profile data from a jev-voice model
 * instance, then renders a structured comparison: per-dimension scores,
 * probability distributions, and the biggest differences. Produces both
 * markdown (human-readable table) and JSON (machine-readable, suitable for
 * rendering radar charts or other visualizations).
 *
 * @module
 */

const dec = new TextDecoder();

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

interface Profile {
  name: string;
  label: string;
  formality: DimResult;
  authority: DimResult;
  complexity: DimResult;
  warmth: DimResult;
  pace: DimResult;
  conviction: DimResult;
  textLength: number;
  textPreview: string;
  model: string;
  evaluatedAt: string;
}

interface DataEntry {
  name: string;
  version: number;
  tags?: Record<string, string>;
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

// ---------------------------------------------------------------------------
// SVG chart generation (pure string, no deps)
// ---------------------------------------------------------------------------

function svgRadar(
  label: string,
  scores: number[],
  size = 200,
): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const n = DIMS.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  const gridLines: string[] = [];
  for (const frac of [0.33, 0.66, 1]) {
    const pts = Array.from({ length: n }, (_, i) => {
      const a = angle(i);
      return `${cx + r * frac * Math.cos(a)},${cy + r * frac * Math.sin(a)}`;
    }).join(" ");
    gridLines.push(
      `<polygon points="${pts}" fill="none" stroke="#888" stroke-width="0.5" opacity="0.3"/>`,
    );
  }

  const spokes = Array.from({ length: n }, (_, i) => {
    const a = angle(i);
    return `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(a)}" y2="${cy + r * Math.sin(a)}" stroke="#888" stroke-width="0.5" opacity="0.3"/>`;
  }).join("");

  const dataPts = scores.map((s, i) => {
    const a = angle(i);
    const v = (s / 3) * r;
    return `${cx + v * Math.cos(a)},${cy + v * Math.sin(a)}`;
  }).join(" ");

  const labels = DIMS.map((d, i) => {
    const a = angle(i);
    const lx = cx + (r + 16) * Math.cos(a);
    const ly = cy + (r + 16) * Math.sin(a);
    const anchor = Math.abs(Math.cos(a)) < 0.1
      ? "middle"
      : Math.cos(a) > 0
      ? "start"
      : "end";
    return `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="central" font-size="9" fill="#666">${d}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
${gridLines.join("\n")}
${spokes}
<polygon points="${dataPts}" fill="rgba(45,120,45,0.15)" stroke="rgba(45,120,45,0.7)" stroke-width="1.5"/>
${labels}
<text x="${cx}" y="${size - 4}" text-anchor="middle" font-size="10" font-weight="bold" fill="#333">${label}</text>
</svg>`;
}

function svgHeatBar(
  dim: Dim,
  profiles: Profile[],
  width = 400,
  rowH = 16,
): string {
  const levels = LEVELS[dim];
  const colors = ["#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"];
  const h = profiles.length * rowH + 30;

  const bars = profiles.map((p, i) => {
    const dist = p[dim].probabilities;
    let x = 60;
    const segs: string[] = [];
    for (let li = 0; li < 4; li++) {
      const pv = dist[String(li)] ?? 0;
      const w = pv * (width - 70);
      if (w > 0.5) {
        segs.push(
          `<rect x="${x}" y="${i * rowH + 20}" width="${w}" height="${rowH - 2}" fill="${colors[li]}" rx="1"/>`,
        );
      }
      x += w;
    }
    const short = p.label.length > 8 ? p.label.slice(0, 8) : p.label;
    return `<text x="58" y="${i * rowH + 20 + rowH / 2 + 3}" text-anchor="end" font-size="7" fill="#555">${short}</text>` +
      segs.join("");
  }).join("\n");

  const legend = levels.map((lv, i) =>
    `<rect x="${60 + i * 80}" y="2" width="10" height="10" fill="${colors[i]}" rx="1"/>` +
    `<text x="${73 + i * 80}" y="11" font-size="7" fill="#666">${lv}</text>`
  ).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="${width}" height="${h}">
${legend}
${bars}
</svg>`;
}

function buildMarkdown(profiles: Profile[]): string {
  if (profiles.length === 0) {
    return "# Voice Comparison\n\nNo profiles found. Run `profile` first.\n";
  }
  if (profiles.length === 1) {
    const p = profiles[0];
    const lines = [`# Voice Profile: ${p.label}\n`];
    lines.push(`| Dimension | Score | Dominant | Confidence |`);
    lines.push(`| --- | ---: | --- | ---: |`);
    for (const dim of DIMS) {
      const d = p[dim];
      lines.push(
        `| ${dim} | ${d.score.toFixed(2)} | ${dominantLevel(dim, d)} | ${pct(d.confidence)} |`,
      );
    }
    lines.push(
      `\n*${p.textLength} chars · ${p.model} · ${p.evaluatedAt.slice(0, 10)}*`,
    );
    return lines.join("\n");
  }

  const lines = ["# Voice Comparison\n"];

  // Summary table
  const header =
    `| Dimension | ${profiles.map((p) => p.label).join(" | ")} |`;
  const sep =
    `| --- | ${profiles.map(() => "---").join(" | ")} |`;
  lines.push(header, sep);

  for (const dim of DIMS) {
    const cells = profiles.map((p) => {
      const d = p[dim];
      return `${d.score.toFixed(1)} ${dominantLevel(dim, d)} (${pct(d.confidence)})`;
    });
    lines.push(`| ${dim} | ${cells.join(" | ")} |`);
  }

  // Key differences
  lines.push("\n## Key differences\n");
  const diffs: Array<{ dim: Dim; spread: number; lo: Profile; hi: Profile }> =
    [];
  for (const dim of DIMS) {
    const sorted = [...profiles].sort((a, b) => a[dim].score - b[dim].score);
    const spread = sorted[sorted.length - 1][dim].score - sorted[0][dim].score;
    if (spread > 0.8) {
      diffs.push({
        dim,
        spread,
        lo: sorted[0],
        hi: sorted[sorted.length - 1],
      });
    }
  }
  diffs.sort((a, b) => b.spread - a.spread);
  if (diffs.length === 0) {
    lines.push("All dimensions within 0.8 — these voices are similar.\n");
  } else {
    for (const { dim, spread, lo, hi } of diffs) {
      lines.push(
        `- **${dim}** (Δ ${spread.toFixed(1)}): ${lo.label} is ${dominantLevel(dim, lo[dim])} (${lo[dim].score.toFixed(1)}) vs ${hi.label} is ${dominantLevel(dim, hi[dim])} (${hi[dim].score.toFixed(1)})`,
      );
    }
  }

  // Rankings — per-dimension leaderboards
  if (profiles.length > 5) {
    lines.push("\n## Rankings\n");
    const N = Math.min(5, profiles.length);

    for (const dim of DIMS) {
      const sorted = [...profiles].sort((a, b) => b[dim].score - a[dim].score);
      const top = sorted.slice(0, N);
      lines.push(`### Highest ${dim}\n`);
      lines.push(`| Rank | Article | Score | Level | Confidence |`);
      lines.push(`| ---: | --- | ---: | --- | ---: |`);
      for (let i = 0; i < top.length; i++) {
        const p = top[i];
        const d = p[dim];
        lines.push(
          `| ${i + 1} | ${p.label} | ${d.score.toFixed(2)} | ${dominantLevel(dim, d)} | ${pct(d.confidence)} |`,
        );
      }
      lines.push("");
    }

    // Distinctiveness — euclidean distance from the centroid
    const means = DIMS.map((d) =>
      profiles.reduce((s, p) => s + p[d].score, 0) / profiles.length
    );
    const ranked = profiles.map((p) => {
      const dist = Math.sqrt(
        DIMS.reduce((s, d, i) => s + (p[d].score - means[i]) ** 2, 0),
      );
      return { profile: p, dist };
    }).sort((a, b) => b.dist - a.dist);

    lines.push("### Most distinctive voices\n");
    lines.push(
      "Distance from the average voice across all 6 dimensions.\n",
    );
    lines.push(`| Rank | Article | Distance | Standout dimension |`);
    lines.push(`| ---: | --- | ---: | --- |`);
    for (let i = 0; i < Math.min(10, ranked.length); i++) {
      const { profile: p, dist } = ranked[i];
      let maxDev = 0;
      let standout: Dim = DIMS[0];
      for (let di = 0; di < DIMS.length; di++) {
        const dev = Math.abs(p[DIMS[di]].score - means[di]);
        if (dev > maxDev) {
          maxDev = dev;
          standout = DIMS[di];
        }
      }
      lines.push(
        `| ${i + 1} | ${p.label} | ${dist.toFixed(2)} | ${standout} (${p[standout].score.toFixed(1)} vs avg ${means[DIMS.indexOf(standout)].toFixed(1)}) |`,
      );
    }
    lines.push("");
  }

  // Author radar charts
  const authorMap: Record<string, Profile[]> = {};
  for (const p of profiles) {
    const slug = p.name.replace(/^profile-/, "");
    const author = slug.replace(/-[^-]+$/, "");
    if (!authorMap[author]) authorMap[author] = [];
    authorMap[author].push(p);
  }

  const authors = Object.entries(authorMap)
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, arts]) => arts.length > 0);

  if (authors.length > 1) {
    lines.push("\n## Author voice signatures\n");
    for (const [author, arts] of authors) {
      const avgs = DIMS.map((d) =>
        arts.reduce((s, p) => s + p[d].score, 0) / arts.length
      );
      lines.push(svgRadar(`${author} (${arts.length})`, avgs));
      lines.push("");
    }
  }

  // Distribution bars per dimension
  if (profiles.length > 3) {
    lines.push("\n## Distribution heatmaps\n");
    for (const dim of DIMS) {
      lines.push(`### ${dim}\n`);
      lines.push(svgHeatBar(dim, profiles.slice(0, 30)));
      lines.push("");
    }
  }

  // Metadata
  lines.push("\n## Profiles\n");
  for (const p of profiles) {
    lines.push(
      `- **${p.label}** — ${p.textLength} chars · ${p.model} · ${p.evaluatedAt.slice(0, 10)}`,
    );
  }

  return lines.join("\n");
}

function buildJson(
  profiles: Profile[],
): Record<string, unknown> {
  const profileData = profiles.map((p) => {
    const dimensions: Record<string, unknown> = {};
    for (const dim of DIMS) {
      const d = p[dim];
      dimensions[dim] = {
        score: d.score,
        dominant: dominantLevel(dim, d),
        confidence: d.confidence,
        distribution: Object.fromEntries(
          LEVELS[dim].map((lvl, i) => [lvl, d.probabilities[String(i)] ?? 0]),
        ),
      };
    }
    return {
      name: p.name,
      label: p.label,
      dimensions,
      textLength: p.textLength,
      model: p.model,
      evaluatedAt: p.evaluatedAt,
    };
  });

  const differences: Record<string, unknown>[] = [];
  for (const dim of DIMS) {
    if (profiles.length < 2) continue;
    const sorted = [...profiles].sort((a, b) => a[dim].score - b[dim].score);
    const spread = sorted[sorted.length - 1][dim].score - sorted[0][dim].score;
    if (spread > 0.8) {
      differences.push({
        dimension: dim,
        spread: Math.round(spread * 100) / 100,
        lowest: { label: sorted[0].label, score: sorted[0][dim].score },
        highest: {
          label: sorted[sorted.length - 1].label,
          score: sorted[sorted.length - 1][dim].score,
        },
      });
    }
  }
  differences.sort(
    (a, b) => (b as { spread: number }).spread - (a as { spread: number }).spread,
  );

  // Rankings
  const rankings: Record<string, unknown> = {};
  if (profiles.length > 5) {
    const N = Math.min(5, profiles.length);
    for (const dim of DIMS) {
      const sorted = [...profiles].sort((a, b) => b[dim].score - a[dim].score);
      rankings[dim] = sorted.slice(0, N).map((p, i) => ({
        rank: i + 1,
        label: p.label,
        name: p.name,
        score: p[dim].score,
        dominant: dominantLevel(dim, p[dim]),
        confidence: p[dim].confidence,
      }));
    }

    const means = DIMS.map((d) =>
      profiles.reduce((s, p) => s + p[d].score, 0) / profiles.length
    );
    const distinctiveness = profiles.map((p) => {
      const dist = Math.sqrt(
        DIMS.reduce((s, d, i) => s + (p[d].score - means[i]) ** 2, 0),
      );
      let maxDev = 0;
      let standout = DIMS[0] as string;
      for (let di = 0; di < DIMS.length; di++) {
        const dev = Math.abs(p[DIMS[di]].score - means[di]);
        if (dev > maxDev) { maxDev = dev; standout = DIMS[di]; }
      }
      return { label: p.label, name: p.name, distance: Math.round(dist * 100) / 100, standout };
    }).sort((a, b) => b.distance - a.distance).slice(0, 10);

    rankings.distinctiveness = distinctiveness;
    rankings.means = Object.fromEntries(DIMS.map((d, i) => [d, Math.round(means[i] * 100) / 100]));
  }

  return {
    profileCount: profiles.length,
    profiles: profileData,
    differences,
    rankings,
    dimensions: DIMS,
    levels: LEVELS,
  };
}

/** Voice comparison report — reads all profiles, renders comparison. */
export const report = {
  name: "@vcjdeboer/voice-comparison",
  description:
    "Compare all voice profiles from a jev-voice model. Reads every " +
    "profile-* data entry and renders a deterministic comparison table " +
    "with per-dimension scores, distributions, and key differences.",
  scope: "model" as const,
  labels: ["voice", "jev", "comparison"],
  execute: async (context: {
    modelType: { type: string };
    modelId: string;
    dataRepository: {
      getContent(
        type: { type: string },
        modelId: string,
        dataName: string,
        version?: number,
      ): Promise<Uint8Array | null>;
      findAllForModel(
        type: { type: string },
        modelId: string,
      ): Promise<DataEntry[]>;
    };
    definition: { name: string };
    logger?: { info(msg: string, meta?: unknown): void };
  }): Promise<{ markdown: string; json: Record<string, unknown> }> => {
    const { modelType, modelId, dataRepository, logger } = context;

    const allData = await dataRepository.findAllForModel(modelType, modelId);
    const EXCLUDE = new Set(["profile-test-trigger", "profile-report-trigger"]);
    const profileEntries = allData.filter(
      (d) =>
        d.tags?.specName === "profile" &&
        d.name.startsWith("profile-") &&
        !EXCLUDE.has(d.name),
    );

    logger?.info(`Found ${profileEntries.length} voice profiles`, {
      names: profileEntries.map((e) => e.name),
    });

    const profiles: Profile[] = [];
    for (const entry of profileEntries) {
      const raw = await dataRepository.getContent(
        modelType,
        modelId,
        entry.name,
        entry.version,
      );
      if (!raw) continue;
      const content = JSON.parse(dec.decode(raw));
      const label = entry.name
        .replace(/^profile-/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      profiles.push({ ...content, name: entry.name, label });
    }

    profiles.sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt));

    return {
      markdown: buildMarkdown(profiles),
      json: buildJson(profiles),
    };
  },
};
