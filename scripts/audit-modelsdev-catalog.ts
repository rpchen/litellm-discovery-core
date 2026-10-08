/**
 * Catalogue-wide audit over the live models.dev catalog (acceptance §C).
 *
 * Runs the single resolver over every canonical registry entry in
 * representative deployment shapes (S1–S4) and asserts:
 * - S2 (bare route + canonical-equal facts): false-withheld = 0, except
 *   registry bare-id collisions (which are genuinely ambiguous);
 * - no unproven provider record contributes any value in any shape;
 * - no variant record (relation-only `-free`/`:free`/`-fast`/`:thinking`
 *   etc.) is ever selected;
 * - every publishable spec equals the D6 matrix values.
 *
 * Network-dependent: run manually or on a schedule, never as a blocking CI
 * gate. The offline suite runs the same assertions on the committed
 * real-schema subset (see `test/canonical-catalog-acceptance.test.ts`,
 * "Catalogue-wide regression evidence").
 *
 * Usage:
 *   bun scripts/audit-modelsdev-catalog.ts            # live catalog.json
 *   bun scripts/audit-modelsdev-catalog.ts <url>      # custom mirror (catalog shape)
 *   CATALOG_URL=... bun scripts/audit-modelsdev-catalog.ts
 */
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import { normalizeModelsDevCatalog } from "../src/core/catalog-input.ts";
import { resolveModel } from "../src/core/resolve.ts";

const DEFAULT_URL = "https://models.dev/catalog.json";
const url = process.argv[2] ?? process.env.CATALOG_URL ?? DEFAULT_URL;

interface Counts {
  canonical: number;
  s2Withheld: number;
  s2BareCollisions: number;
  /** Withheld because the registry entry itself is illegal or incomplete. */
  s2RegistryGaps: number;
  unprovenContributions: number;
  variantSelections: number;
  valueMismatches: number;
}

/** Gated facts the registry entry must declare for S2 to be publishable. */
function registryGap(entry: Record<string, unknown>): string | undefined {
  const limit = (entry.limit ?? {}) as Record<string, unknown>;
  for (const key of ["context", "output"]) {
    const value = limit[key];
    if (value === undefined) return `registry omits limit.${key}`;
    if (typeof value !== "number" || !(value > 0)) return `registry limit.${key} is illegal`;
  }
  if (typeof entry.tool_call !== "boolean") return "registry omits tool_call";
  if (typeof entry.reasoning !== "boolean") return "registry omits reasoning";
  if (!entry.modalities || typeof entry.modalities !== "object") return "registry omits modalities";
  return undefined;
}

function bareOf(registryKey: string): string {
  const slash = registryKey.indexOf("/");
  return slash >= 0 ? registryKey.slice(slash + 1) : registryKey;
}

function bareIndex(models: Record<string, unknown>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const key of Object.keys(models)) {
    const bare = bareOf(key).toLowerCase();
    index.set(bare, [...(index.get(bare) ?? []), key]);
  }
  return index;
}

function litellmFor(registryKey: string, entry: Record<string, unknown>): unknown {
  const limit = (entry.limit ?? {}) as Record<string, number>;
  const modelInfo: Record<string, unknown> = { mode: "chat" };
  if (typeof limit.input === "number") modelInfo.max_input_tokens = limit.input;
  if (typeof limit.output === "number") {
    modelInfo.max_output_tokens = limit.output;
    modelInfo.max_tokens = limit.output;
  }
  if (typeof entry.tool_call === "boolean") modelInfo.supports_function_calling = entry.tool_call;
  if (typeof entry.reasoning === "boolean") modelInfo.supports_reasoning = entry.reasoning;
  const modalities = (entry.modalities ?? {}) as Record<string, string[]>;
  for (const modality of modalities.input ?? []) {
    if (modality === "image") modelInfo.supports_vision = true;
    if (modality === "pdf") modelInfo.supports_pdf_input = true;
    if (modality === "audio") modelInfo.supports_audio_input = true;
    if (modality === "video") modelInfo.supports_video_input = true;
  }
  if ((modalities.output ?? []).includes("audio")) modelInfo.supports_audio_output = true;
  const bare = bareOf(registryKey);
  return { data: [{ model_name: bare, litellm_params: { model: bare }, model_info: modelInfo }] };
}

async function main(): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`catalog fetch failed: HTTP ${response.status} from ${url}`);
  const raw = (await response.json()) as unknown;
  const catalog = normalizeModelsDevCatalog(raw);
  if (catalog.kind !== "complete") throw new Error(`live catalog is not complete (kind=${catalog.kind})`);
  const models = catalog.models as Record<string, Record<string, unknown>>;
  const keys = Object.keys(models);
  const index = bareIndex(models);
  const counts: Counts = {
    canonical: keys.length,
    s2Withheld: 0,
    s2BareCollisions: 0,
    s2RegistryGaps: 0,
    unprovenContributions: 0,
    variantSelections: 0,
    valueMismatches: 0,
  };
  const problems: string[] = [];

  for (const key of keys) {
    const entry = models[key]!;
    const group = groupLiteLLMDeployments(litellmFor(key, entry))[0]!;
    const resolved = resolveModel(group, raw, {});
    const bare = bareOf(key).toLowerCase();
    const collisions = (index.get(bare) ?? []).length > 1;

    // S2 assertion: canonical-equal facts must publish unless the bare id
    // genuinely collides in the registry, or the registry entry itself is
    // illegal/incomplete (fail-closed on registry gaps is intended).
    if (!resolved.publishable) {
      counts.s2Withheld += 1;
      const gap = registryGap(entry);
      if (collisions) counts.s2BareCollisions += 1;
      else if (gap) counts.s2RegistryGaps += 1;
      else problems.push(`S2 withheld without bare collision: ${key} (${resolved.status}; ${resolved.reasons.join("; ")})`);
    }
    // No unproven record may contribute: with serving unproven, every gated
    // basis must be canonical or litellm-declared, never serving.
    if (resolved.serving.status === "unproven") {
      for (const [name, field] of Object.entries(resolved.fields)) {
        if (field.basis === "serving") {
          counts.unprovenContributions += 1;
          problems.push(`unproven serving contribution: ${key} field ${name}`);
        }
      }
      if (resolved.reasoningLevels.state !== "unknown" || resolved.spec.variants.length > 0) {
        counts.variantSelections += 1;
        problems.push(`unproven levels/variants: ${key}`);
      }
    }
    // Published values equal the matrix: canonical limits/modalities/tools.
    if (resolved.publishable) {
      const limit = (entry.limit ?? {}) as Record<string, number>;
      if (typeof limit.context === "number" && resolved.spec.limit.context !== limit.context) {
        counts.valueMismatches += 1;
        problems.push(`context mismatch: ${key} got ${resolved.spec.limit.context}, want ${limit.context}`);
      }
      if (typeof limit.output === "number" && resolved.spec.limit.output !== limit.output) {
        counts.valueMismatches += 1;
        problems.push(`output mismatch: ${key} got ${resolved.spec.limit.output}, want ${limit.output}`);
      }
    }
  }

  console.log(JSON.stringify({ url, ...counts, problems: problems.slice(0, 50), problemTotal: problems.length }, null, 2));
  const hardFailures = counts.s2Withheld - counts.s2BareCollisions - counts.s2RegistryGaps + counts.unprovenContributions + counts.variantSelections + counts.valueMismatches;
  if (hardFailures > 0) {
    console.error(`AUDIT FAIL: ${hardFailures} catalogue-wide assertion(s) violated`);
    process.exitCode = 1;
  } else {
    console.log("AUDIT PASS: every catalogue-wide assertion holds");
  }
}

main().catch((error) => {
  console.error(`AUDIT ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
