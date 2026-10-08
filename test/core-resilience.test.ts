/**
 * Discovery resilience (adopt-modelsdev-canonical-catalog, task 6.3 rewrite).
 *
 * Catalog-shape fixtures throughout (`{ models, providers }`). Removed
 * semantics and their reasons:
 * - reseller/unique/canonical-original record selection (D5) → unproven
 *   records never supply facts; live regressions now assert canonical
 *   values with reseller records present-but-ignored.
 * - `litellm_params` narrowing / fallback-serving authority / unique-match /
 *   explicit-provider-as-fallback (D7a/D5) → operator configuration never
 *   narrows; serving requires declaration + exact SKU.
 * - LKG v7 capture/validate shapes → schema 8 proof composition with
 *   capture-from-the-same-resolution (D10/5.3).
 * - Modality/limit gap-fill from unproven records → registry or LiteLLM
 *   declarations only.
 *
 * Kept: partial-catalog partition math, acknowledgement suppression,
 * fingerprint stability, regression/newly-withheld reporting.
 */
import { describe, expect, test } from "bun:test"
import { groupLiteLLMDeployments, type DeploymentGroup } from "../src/core/litellm.ts"
import { buildModelSpecs } from "../src/core/build.ts"
import {
  assessModelConfiguration,
  buildPublicationResult,
  capturedPublicationVerdict,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  lastKnownGoodKey,
  resolveConfigurationWithLKG,
  withheldReasons,
  PUBLICATION_SCHEMA_VERSION,
  type PublicationResult,
} from "../src/core/publication.ts"
import {
  R3_CATALOG,
  R3_LITELLM,
  R4_CATALOG,
  R4_LITELLM,
  R5_CATALOG,
  R5_LITELLM,
} from "./fixtures/canonical-catalog-fixtures.ts"
import {
  buildCatalogPublication,
  catalogDegradationFingerprint,
  catalogFromPublication,
  decideAcknowledgement,
  nextPublishedBaseline,
  parsePublicationMemory,
  serializePublicationMemory,
  withheldModelFingerprint,
  PUBLICATION_MEMORY_SCHEMA_VERSION,
  type CatalogPublication,
  type DegradationAcknowledgement,
  type PublicationMemory,
} from "../src/core/catalog.ts"

const options = { contextTierCap: false, protocolOverrides: {} } as const

function groupOf(modelName: string, modelInfo: Record<string, unknown>, params: Record<string, unknown> = {}): DeploymentGroup {
  return groupLiteLLMDeployments({
    data: [{ model_name: modelName, litellm_params: { model: params.model ?? "custom/" + modelName, ...params }, model_info: { mode: "chat", ...modelInfo } }],
  })[0]!
}

function shape(models: Record<string, unknown>, providers: Record<string, unknown> = {}) {
  return {
    models,
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, records]) => [provider, { models: records }]),
    ),
  }
}

const COMPLETE_INFO = {
  max_input_tokens: 128_000,
  max_output_tokens: 32_000,
  supports_function_calling: true,
  supports_reasoning: false,
  supports_vision: false,
  supports_pdf_input: false,
  supports_audio_input: false,
  supports_video_input: false,
  supports_audio_output: false,
}

// ---------------------------------------------------------------------------
// Live regressions, new behavior (R-level depth lives in acceptance tests)
// ---------------------------------------------------------------------------

describe("resilience: live model regressions", () => {
  test("deepseek-v4.1-flash publishes canonical 384000 while reseller records stay inert", () => {
    const result = buildPublicationResult(R4_LITELLM(), R4_CATALOG, options)
    const entry = result.publishable.find((item) => item.spec.id === "deepseek-v4.1-flash")
    expect(result.blocked).toEqual([])
    expect(entry!.spec.limit.output).toBe(384000)
    expect(entry!.spec.variants).toEqual([])
  })

  test("glm-5.3-flash publishes registry modalities without serving levels", () => {
    const result = buildPublicationResult(R5_LITELLM(), R5_CATALOG, options)
    const entry = result.publishable.find((item) => item.spec.id === "glm-5.3-flash")
    expect(result.blocked).toEqual([])
    expect(entry!.spec.capabilities.input).toEqual(["text", "image"])
    expect(entry!.spec.variants).toEqual([])
  })

  test("minimax-m3 publishes canonical limits with an output discrepancy", () => {
    const result = buildPublicationResult(R3_LITELLM(), R3_CATALOG, options)
    const entry = result.publishable.find((item) => item.spec.id === "minimax-m3")
    expect(result.blocked).toEqual([])
    expect(entry!.spec.limit).toEqual({ context: 1048576, input: 1000000, output: 512000 })
    expect(entry!.assessment.discrepancies.map((item) => item.field)).toContain("limit.output")
  })
})

// ---------------------------------------------------------------------------
// Source authority (canonical registry + proven serving only)
// ---------------------------------------------------------------------------

describe("resilience: source authority", () => {
  const record = { tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] }, limit: { context: 100, output: 10 } }

  test("canonical registry decides without any provider record", () => {
    const doc = shape({ "vendor/mm": { ...record } })
    const assessment = assessModelConfiguration(groupOf("mm", { ...COMPLETE_INFO, max_input_tokens: 100, max_output_tokens: 10 }, { model: "mm" }), doc, options)
    expect(assessment.status).toBe("configured")
    expect(assessment.context.value).toBe(100)
    expect(assessment.fieldBasis?.["limit.context"]).toBe("canonical")
  })

  test("unproven provider records never fill gaps or outrank declarations", () => {
    const doc = shape({ "vendor/mm": { ...record } }, { vendor: { mm: { id: "mm", limit: { context: 999, output: 99 } } } })
    const assessment = assessModelConfiguration(groupOf("mm", { ...COMPLETE_INFO, max_input_tokens: 100, max_output_tokens: 10 }, { model: "mm" }), doc, options)
    expect(assessment.status).toBe("configured")
    expect(assessment.context.value).toBe(100)
  })

  test("declared serving record with an exact SKU wins", () => {
    const doc = shape(
      { "vendor/mm": { ...record, limit: { context: 100, output: 10 } } },
      { vendor: { mm: { id: "mm", limit: { context: 200, output: 20 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } } },
    )
    const assessment = assessModelConfiguration(
      groupOf("mm", { ...COMPLETE_INFO, max_input_tokens: 200, max_output_tokens: 20, models_dev_provider: "vendor" }, { model: "mm" }),
      doc, options,
    )
    expect(assessment.status).toBe("configured")
    expect(assessment.context.value).toBe(200)
    expect(assessment.fieldBasis?.["limit.context"]).toBe("serving")
  })

  test("illegal declared values stay illegal with a complete registry", () => {
    const doc = shape({ "vendor/mm": { ...record } })
    const assessment = assessModelConfiguration(groupOf("mm", { ...COMPLETE_INFO, max_output_tokens: 0 }, { model: "mm" }), doc, options)
    expect(assessment.status).toBe("invalid-metadata")
    expect(assessment.illegalFields).toContain("limit.output")
  })
})

// ---------------------------------------------------------------------------
// Partial catalog
// ---------------------------------------------------------------------------

describe("resilience: partial catalog", () => {
  const complete = { ...COMPLETE_INFO }

  /** 20 discovered models: 18 fully configured, 2 with distinct blockers. */
  function twentyModels() {
    const data: unknown[] = []
    for (let index = 0; index < 18; index += 1) {
      data.push({
        model_name: `ok-${index}`,
        litellm_params: { model: `custom/ok-${index}` },
        model_info: { mode: "chat", ...complete },
      })
    }
    // metadata unavailable: no limits at all and no enrichment
    data.push({ model_name: "withheld-missing", litellm_params: { model: "custom/withheld-missing" }, model_info: { mode: "chat" } })
    // illegal declared limit
    data.push({
      model_name: "withheld-illegal",
      litellm_params: { model: "custom/withheld-illegal" },
      model_info: { mode: "chat", ...complete, max_output_tokens: 0 },
    })
    return { data }
  }

  test("18 of 20 models publish immediately; the other 2 are withheld with reasons", () => {
    // Registry holds duplicate bare ids so the shared-name model is
    // genuinely identity-ambiguous even without provider records.
    const catalog = shape({ "a/shared": { limit: { context: 1, output: 1 } }, "b/shared": { limit: { context: 1, output: 1 } } })
    const body = { data: [...(twentyModels().data as unknown[]), { model_name: "shared", litellm_params: { model: "shared" }, model_info: { mode: "chat", ...complete } }] }
    const result = buildPublicationResult(body, catalog, options)
    expect(result.publishable.length).toBe(18)
    expect(result.blocked.length).toBe(3)
    const catalogFacts = catalogFromPublication(result, { discovered: 21 })
    expect(catalogFacts.discovered).toBe(21)
    expect(catalogFacts.publishable.length).toBe(18)
    expect(catalogFacts.partial).toBeTrue()
    expect(catalogFacts.unusable).toBeFalse()
    expect(catalogFacts.withheld.map((entry) => entry.id).sort()).toEqual(["shared", "withheld-illegal", "withheld-missing"])
    const reasons = Object.fromEntries(catalogFacts.withheld.map((entry) => [entry.id, entry.reasons.map((reason) => reason.code)]))
    expect(reasons["withheld-missing"]).toContain("incomplete-metadata")
    expect(reasons["withheld-illegal"]).toContain("illegal-metadata")
    expect(reasons["shared"]).toContain("identity-ambiguous")
  })

  test("discovered > 0 with zero publishable is reported as an unusable catalog", () => {
    const data = [
      { model_name: "gone", litellm_params: { model: "custom/gone" }, model_info: { mode: "chat" } },
    ]
    const result = buildPublicationResult({ data }, {}, options)
    expect(result.publishable.length).toBe(0)
    const facts = catalogFromPublication(result, { discovered: 1 })
    expect(facts.unusable).toBeTrue()
    expect(facts.partial).toBeFalse()
  })

  test("a withheld model recovering is published automatically without user approval", () => {
    const first = buildPublicationResult({ data: [{ model_name: "ok", litellm_params: { model: "custom/ok" }, model_info: { mode: "chat", ...complete } }, { model_name: "late", litellm_params: { model: "custom/late" }, model_info: { mode: "chat" } }] }, {}, options)
    expect(first.publishable.map((entry) => entry.spec.id)).toEqual(["ok"])
    const before = catalogFromPublication(first, { discovered: 2 })
    expect(before.withheld.map((entry) => entry.id)).toEqual(["late"])
    expect(before.newlyWithheld.map((entry) => entry.id)).toEqual(["late"])
    expect(before.regressions).toEqual([])

    // The same model becomes complete: nothing else is required to publish it.
    const second = buildPublicationResult(
      { data: [{ model_name: "ok", litellm_params: { model: "custom/ok" }, model_info: { mode: "chat", ...complete } }, { model_name: "late", litellm_params: { model: "custom/late" }, model_info: { mode: "chat", ...complete } }] },
      {},
      options,
    )
    const after = catalogFromPublication(second, { discovered: 2, previouslyPublished: new Set(["ok"]) })
    expect(after.withheld).toEqual([])
    expect([...after.publishable].sort()).toEqual(["late", "ok"])
    expect(after.unusable).toBeFalse()
  })

  test("a previously published model becoming withheld is a regression", () => {
    const previouslyPublished = new Set(["ok-0", "ok-1"])
    const result = buildPublicationResult(
      {
        data: [
          { model_name: "ok-0", litellm_params: { model: "custom/ok-0" }, model_info: { mode: "chat", ...complete } },
          { model_name: "ok-1", litellm_params: { model: "custom/ok-1" }, model_info: { mode: "chat" } },
          { model_name: "brand-new", litellm_params: { model: "custom/brand-new" }, model_info: { mode: "chat" } },
        ],
      },
      {},
      options,
    )
    const facts = catalogFromPublication(result, { discovered: 3, previouslyPublished })
    expect(facts.regressions.map((entry) => entry.id)).toEqual(["ok-1"])
    expect(facts.newlyWithheld.map((entry) => entry.id)).toEqual(["brand-new"])
    expect(facts.partial).toBeTrue()
  })
})

// ---------------------------------------------------------------------------
// Acknowledgement: notification suppression only
// ---------------------------------------------------------------------------

describe("resilience: acknowledgement", () => {
  function withheld(id: string, status: "discovered-incomplete" | "ambiguous" = "discovered-incomplete", code = "incomplete-metadata") {
    return {
      id,
      status,
      reasons: [{ code: code as never, message: "x", fields: ["limit.output"] }],
      retryable: false,
    }
  }

  test("a first-observation gap is not interruptive, an unusable catalog always is", () => {
    const one = buildCatalogPublication({ publishable: [{ id: "a", usingLKG: false }], withheld: [withheld("b")], discovered: 2 })
    const first = decideAcknowledgement(undefined, one, "2026-01-01T00:00:00.000Z")
    expect(first.notify).toBeFalse()
    expect(first.reason).toBe("first-observation")
    expect(first.next).toBeUndefined()

    const unusable = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b")], discovered: 2 })
    const loud = decideAcknowledgement(undefined, unusable, "2026-01-01T00:00:00.000Z")
    expect(loud.notify).toBeTrue()
    expect(loud.reason).toBe("catalog-unusable")
  })

  test("improvement stays quiet, full recovery clears state, new problems re-notify", () => {
    const two = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b")], discovered: 2 })
    const acknowledged = decideAcknowledgement(undefined, two, "2026-01-01T00:00:00.000Z")
    void acknowledged
    const state: DegradationAcknowledgement = acknowledged.next!

    const improved = buildCatalogPublication({ publishable: [{ id: "a", usingLKG: false }], withheld: [withheld("b")], discovered: 2 })
    expect(decideAcknowledgement(state, improved, "2026-01-02T00:00:00.000Z").notify).toBeFalse()
    expect(decideAcknowledgement(state, improved, "2026-01-02T00:00:00.000Z").reason).toBe("improved")

    const recovered = buildCatalogPublication({ publishable: [{ id: "a", usingLKG: false }, { id: "b", usingLKG: false }], withheld: [], discovered: 2 })
    const cleared = decideAcknowledgement(state, recovered, "2026-01-02T00:00:00.000Z")
    expect(cleared.notify).toBeFalse()
    expect(cleared.reason).toBe("catalog-recovered")
    expect(cleared.next).toBeUndefined()

    const grew = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b"), withheld("c")], discovered: 3 })
    expect(decideAcknowledgement(state, grew, "2026-01-02T00:00:00.000Z").notify).toBeTrue()

    // A materially different failure reason for the same model is a new issue.
    const changed = buildCatalogPublication({ publishable: [{ id: "healthy", usingLKG: false }], withheld: [withheld("a", "ambiguous", "identity-ambiguous"), withheld("b")], discovered: 3 })
    expect(decideAcknowledgement(state, changed, "2026-01-02T00:00:00.000Z").notify).toBeTrue()
    expect(decideAcknowledgement(state, changed, "2026-01-02T00:00:00.000Z").reason).toBe("new-issues")
  })

  test("a previously published model becoming withheld outranks a quiet first-time gap", () => {
    const facts = buildCatalogPublication({
      publishable: [{ id: "healthy", usingLKG: false }],
      withheld: [withheld("was-published"), withheld("new-model")],
      discovered: 3,
      previouslyPublished: new Set(["was-published"]),
    })
    const decision = decideAcknowledgement(undefined, facts, "2026-01-01T00:00:00.000Z")
    expect(decision.notify).toBeTrue()
    expect(decision.reason).toBe("regression")
  })

  test("fingerprints ignore timestamps, counters, and message detail", () => {
    const left = withheldModelFingerprint("discovered-incomplete", [{ code: "incomplete-metadata", message: "first", fields: ["limit.output"] }])
    const right = withheldModelFingerprint("discovered-incomplete", [{ code: "incomplete-metadata", message: "retry 7 failed at 12:00", fields: ["limit.output"] }])
    expect(left).toBe(right)
    expect(catalogDegradationFingerprint([])).toBe("sha256:none")
  })

  test("acknowledgement state never participates in publication", () => {
    const decision = decideAcknowledgement(undefined, buildCatalogPublication({
      publishable: [],
      withheld: [withheld("a")],
      discovered: 1,
    }), "2026-01-01T00:00:00.000Z")
    expect(decision.next).toBeDefined()
    // A stored acknowledgement is inert data: the publication partition above
    // still reports zero publishable models and the model stays withheld.
    const stored: DegradationAcknowledgement = decision.next!
    expect(stored.schemaVersion).toBe(1)
    expect(PUBLICATION_SCHEMA_VERSION).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// Trusted LKG state machine (schema 8)
// ---------------------------------------------------------------------------

describe("resilience: trusted LKG state machine", () => {
  const PARTIAL = {
    max_input_tokens: 90000,
    max_output_tokens: 10000,
    supports_function_calling: true,
    supports_reasoning: false,
    supports_vision: true,
  }
  const doc = shape({
    "labA/complete": {
      limit: { context: 128000, input: 90000, output: 32000 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: true,
      reasoning: false,
    },
  })

  function response(modelName: string, info: Record<string, unknown>) {
    return { data: [{ model_name: modelName, litellm_params: { model: modelName }, model_info: { mode: "chat", ...info } }] }
  }

  function seed(body: unknown, catalog: unknown, modelName: string) {
    const g = groupLiteLLMDeployments(body)[0]!
    const publication = buildPublicationResult(body, catalog, options)
    const live = publication.publishable.find((item) => item.spec.id === modelName)!
    const entry = createLastKnownGoodEntry(g, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), catalog, options)
    return { group: g, live, entry }
  }

  test("fresh configured -> metadata outage -> configured via trusted LKG -> recovery back to fresh", () => {
    const store = createLastKnownGoodStore()
    const first = buildPublicationResult(response("complete", PARTIAL), doc, options, { store, now: 1000 })
    expect(first.publishable[0]!.assessment.status).toBe("configured")
    const { entry } = seed(response("complete", PARTIAL), doc, "complete")
    store.set("complete", entry)

    const outage = buildPublicationResult(response("complete", PARTIAL), {}, options, { store, now: 2000, failure: { kind: "unreachable", retryable: true } })
    expect(outage.publishable[0]!.assessment.status).toBe("configured-lkg")
    expect(outage.publishable[0]!.spec).toEqual(first.publishable[0]!.spec)

    const recovery = buildPublicationResult(response("complete", PARTIAL), doc, options, { store, now: 3000 })
    expect(recovery.publishable[0]!.assessment.status).toBe("configured")
    expect(recovery.publishable[0]!.assessment.usingLKG).toBeFalse()
  })

  test("an LKG entry never resurrects a model LiteLLM no longer serves", () => {
    const { entry } = seed(response("complete", PARTIAL), doc, "complete")
    const store = createLastKnownGoodStore()
    store.set("complete", entry)
    const gone = buildPublicationResult({ data: [] }, {}, options, { store })
    expect(gone.publishable).toEqual([])
    expect(gone.blocked).toEqual([])
  })

  test("changing the deployment inputs invalidates the stored snapshot", () => {
    const { entry } = seed(response("complete", PARTIAL), doc, "complete")
    const changed = groupLiteLLMDeployments(response("complete", PARTIAL))[0]!
    // Same evidence restores...
    const store = createLastKnownGoodStore()
    store.set("complete", entry)
    const outage = buildPublicationResult(response("complete", PARTIAL), {}, options, { store })
    expect(outage.publishable.find((item) => item.spec.id === "complete")).toBeDefined()
    // ...but a changed route does not.
    const rerouted = response("complete", PARTIAL)
    rerouted.data[0]!.litellm_params.model = "other"
    const reroutedOutage = buildPublicationResult(rerouted, {}, options, { store })
    expect(reroutedOutage.publishable.find((item) => item.spec.id === "complete")).toBeUndefined()
    void changed
  })

  test("an incompatible stored schema fails safe instead of restoring", () => {
    const { group: g, entry } = seed(response("complete", PARTIAL), doc, "complete")
    const store = createLastKnownGoodStore()
    store.set("complete", { ...entry, schemaVersion: 7 } as never)
    const outage = buildPublicationResult(response("complete", PARTIAL), {}, options, { store })
    expect(outage.publishable.find((item) => item.spec.id === "complete")).toBeUndefined()
    void g
  })

  test("LKG restore requires identical deployment evidence", () => {
    const { entry } = seed(response("complete", PARTIAL), doc, "complete")
    const altered = groupLiteLLMDeployments(response("complete", { ...PARTIAL, base_model: "other" }))[0]!
    const store = createLastKnownGoodStore()
    store.set("complete", entry)
    const outage = buildPublicationResult(response("complete", { ...PARTIAL, base_model: "other" }), {}, options, { store })
    expect(outage.publishable.find((item) => item.spec.id === "complete")).toBeUndefined()
    void altered
  })
})

// ---------------------------------------------------------------------------
// Acknowledgement persistence (unchanged infrastructure)
// ---------------------------------------------------------------------------

describe("resilience: acknowledgement persistence", () => {
  test("publication memory round-trips acknowledgement and baselines", () => {
    const memory: PublicationMemory = {
      schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
      acknowledgement: {
        schemaVersion: 1,
        fingerprint: "sha256:abc",
        models: { a: withheldModelFingerprint("ambiguous", [{ code: "identity-ambiguous", message: "x", fields: ["identity"] }]) },
        acknowledgedAt: "2026-01-01T00:00:00.000Z",
      },
      published: ["a", "b"],
    }
    const serialized = serializePublicationMemory(memory)
    const parsed = parsePublicationMemory(serialized)!
    expect(parsed.published).toEqual(["a", "b"])
    expect(parsed.acknowledgement?.fingerprint).toBe("sha256:abc")
    expect(nextPublishedBaseline(["a", "old"], ["b"], ["c"])).toEqual(["b"])
  })

  test("corrupt memory never publishes or withholds by itself", () => {
    expect(parsePublicationMemory("not-json")).toBeUndefined()
    expect(parsePublicationMemory({ schemaVersion: 999 })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Modality sets reach the published spec (registry complete sets)
// ---------------------------------------------------------------------------

describe("resilience: authoritative modality sets reach the published spec", () => {
  const doc = shape({
    "labA/mm": {
      limit: { context: 100, output: 10 },
      tool_call: true,
      reasoning: false,
      modalities: { input: ["text", "image"], output: ["text"] },
    },
  })

  test("registry image set decides; LiteLLM audio hint is a discrepancy, not a conflict", () => {
    const group = groupOf("mm", { ...COMPLETE_INFO, max_input_tokens: 100, max_output_tokens: 10, supports_audio_input: true }, { model: "mm" })
    const assessment = assessModelConfiguration(group, doc, options)
    expect(assessment.status).toBe("configured")
    expect([...assessment.inputModalities.values].sort()).toEqual(["image", "text"])
  })

  test("unlisted modalities stay unsupported without a conflict", () => {
    const group = groupOf("mm", { ...COMPLETE_INFO, max_input_tokens: 100, max_output_tokens: 10 }, { model: "mm" })
    const assessment = assessModelConfiguration(group, doc, options)
    // COMPLETE_INFO declares every flag false: the direction is fully
    // declared and agrees with the registry set (no audio).
    expect(assessment.inputModalities.known).toBeTrue()
  })
})

// ---------------------------------------------------------------------------
// Operator configuration never narrows (D7a)
// ---------------------------------------------------------------------------

describe("resilience: operator configuration never narrows", () => {
  const doc = shape({
    "labA/m": {
      limit: { context: 500000, output: 500000 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: true,
      reasoning: false,
    },
  })

  test("litellm_params caps do not narrow canonical limits", () => {
    const group = groupOf(
      "m",
      { ...COMPLETE_INFO, max_input_tokens: 500000, max_output_tokens: 500000 },
      { model: "m", max_tokens: 100000, max_input_tokens: 100000, supports_function_calling: false },
    )
    const assessment = assessModelConfiguration(group, doc, options)
    expect(assessment.status).toBe("configured")
    expect(assessment.output.value).toBe(500000)
    expect(assessment.tools.state).toBe("supported")
  })

  test("cross-deployment descriptive disagreement stays a conflict", () => {
    const litellm = {
      data: [
        { model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", ...COMPLETE_INFO, max_input_tokens: 500000, max_output_tokens: 100 } },
        { model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", ...COMPLETE_INFO, max_input_tokens: 500000, max_output_tokens: 200 } },
      ],
    }
    const assessment = assessModelConfiguration(groupLiteLLMDeployments(litellm)[0]!, doc, options)
    expect(assessment.status).toBe("invalid-metadata")
    expect(assessment.conflicts.map((item) => item.field)).toContain("limit.output")
  })
})

// ---------------------------------------------------------------------------
// Price authority (operator-declared first, proven serving second)
// ---------------------------------------------------------------------------

describe("resilience: price authority", () => {
  test("operator-declared pricing wins; unproven serving costs stay unknown", () => {
    const doc = shape(
      { "labA/m": { limit: { context: 100, output: 10 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } },
      { labA: { m: { id: "m", limit: { context: 100, output: 10 }, cost: { input: 99, output: 99 } } } },
    )
    const group = groupOf(
      "m",
      { ...COMPLETE_INFO, max_input_tokens: 100, max_output_tokens: 10, input_cost_per_token: 0.00000015 },
      { model: "m" },
    )
    const spec = buildModelSpecs(
      { data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", ...COMPLETE_INFO, max_input_tokens: 100, max_output_tokens: 10, input_cost_per_token: 0.00000015 } }] },
      doc, options,
    )[0]!
    expect(spec.cost.input).toBeCloseTo(0.15, 10)
    expect(spec.cost.output).toBe(0)
    void group
  })

  test("proven serving cost fills undeclared components", () => {
    const doc = shape(
      { "labA/m": { limit: { context: 100, output: 10 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } },
      { labA: { m: { id: "m", limit: { context: 100, output: 10 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false, cost: { input: 0.15, output: 0.6, cache_read: 0.003 } } } },
    )
    const body = { data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", ...COMPLETE_INFO, max_input_tokens: 100, max_output_tokens: 10, models_dev_provider: "labA" } }] }
    const spec = buildModelSpecs(body, doc, options)[0]!
    expect(spec.cost.input).toBeCloseTo(0.15, 10)
    expect(spec.cost.cacheRead).toBeCloseTo(0.003, 10)
  })
})

// ---------------------------------------------------------------------------
// LKG outage policy over proof components
// ---------------------------------------------------------------------------

describe("resilience: LKG outage policy", () => {
  const doc = shape({
    "labA/m": {
      limit: { context: 100, input: 90, output: 10 },
      modalities: { input: ["text"], output: ["text"] },
      tool_call: true,
      reasoning: false,
    },
  })
  const info = {
    max_input_tokens: 90,
    max_output_tokens: 10,
    supports_function_calling: true,
    supports_reasoning: false,
    supports_vision: true,
  }
  function body(extra: Record<string, unknown> = {}) {
    return { data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", ...info, ...extra } }] }
  }
  function seedEntry(catalog: unknown = doc) {
    const g = groupLiteLLMDeployments(body())[0]!
    const publication = buildPublicationResult(body(), catalog, options)
    const live = publication.publishable.find((item) => item.spec.id === "m")!
    return createLastKnownGoodEntry(g, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), catalog, options)
  }

  test("canonical entry restores through an outage and refreshes live afterwards", () => {
    const entry = seedEntry()
    const store = createLastKnownGoodStore()
    store.set("m", entry)
    const outage = buildPublicationResult(body(), {}, options, { store })
    expect(outage.publishable.find((item) => item.spec.id === "m")?.assessment.status).toBe("configured-lkg")
    const recovery = buildPublicationResult(body(), doc, options, { store })
    expect(recovery.publishable.find((item) => item.spec.id === "m")?.assessment.status).toBe("configured")
  })

  test("changed litellm-declared components reject the entry as a whole (G20b)", () => {
    // G20b: price is the litellm-declared component here, so the LiteLLM
    // fingerprint gates it. A price-only change rejects the whole entry
    // instead of restoring any field.
    const priced = { ...info, input_cost_per_token: 0.00000015 }
    const pricedBody = { data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", ...priced } }] }
    const g = groupLiteLLMDeployments(pricedBody)[0]!
    const publication = buildPublicationResult(pricedBody, doc, options)
    const live = publication.publishable.find((item) => item.spec.id === "m")!
    expect(live.assessment.fieldBasis?.["price.input"]).toBe("litellm-declared")
    const entry = createLastKnownGoodEntry(g, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), doc, options)
    const store = createLastKnownGoodStore()
    store.set("m", entry)
    const changedBody = { data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", ...priced, input_cost_per_token: 0.00000099 } }] }
    const changed = buildPublicationResult(changedBody, {}, options, { store })
    expect(changed.publishable.find((item) => item.spec.id === "m")).toBeUndefined()
  })

  test("withheld assessments never consult LKG", () => {
    const entry = seedEntry()
    const store = createLastKnownGoodStore()
    store.set("m", entry)
    const illegal = buildPublicationResult(body({ max_output_tokens: 0 }), doc, options, { store })
    const blocked = illegal.blocked.find((item) => item.spec.id === "m")
    expect(blocked).toBeDefined()
    expect(blocked!.assessment.status).toBe("invalid-metadata")
  })
})
