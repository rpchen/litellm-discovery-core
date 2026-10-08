/**
 * Publication policy tests (adopt-modelsdev-canonical-catalog, task 6.3 rewrite).
 *
 * Every test uses catalog-shape fixtures (`{ models, providers }`); legacy
 * provider-map payloads classify as `providers-only` and never resolve
 * canonical identity or serving records (see resolve-matrix tests).
 *
 * Rewritten sections (old → new, with reasons):
 * - normal match / identity / fallbacks / alias / unique / equivalent →
 *   canonical-registry proof + declared-serving proof only (D3–D5; all
 *   unproven-record selection deleted).
 * - deterministic inheritance → deleted; serving records are final views and
 *   cross-provider copies never happen (D5/D6).
 * - group limit evidence with max_input_tokens-as-context → dimension
 *   isolation: max_input_tokens never becomes context outside LiteLLM-only
 *   (G15/G30/R9); cross-deployment disagreement stays an unresolved
 *   conflict under every branch.
 * - LKG sections → schema 8 proof composition, whole-entry re-proof, and
 *   capture-from-the-same-resolution (D10/5.3); v7 entries fail closed.
 * - evidence-authority guard → removed API; forged-proof checks live in
 *   resolve-matrix tests (G43) and below.
 * - fixture regression → canonical-shape spot verdicts (R-level depth lives
 *   in canonical-catalog-acceptance tests).
 */
import { describe, expect, test } from "bun:test"
import litellmFixture from "./fixtures/litellm-model-info.json" with { type: "json" }
import { buildModelSpecs } from "../src/core/build.ts"
import { groupLiteLLMDeployments, type DeploymentGroup } from "../src/core/litellm.ts"
import {
  groupIdentityConflict,
  resolveReasoningState,
  selectModelsDevRecord,
  selectModelsDevRecordDetailed,
} from "../src/core/modelsdev.ts"
import { resolveProtocol } from "../src/core/protocol.ts"
import {
  assessModelConfiguration,
  buildPublicationResult,
  capturedPublicationVerdict,
  classifyMetadataFailure,
  createLastKnownGoodEntry,
  createLastKnownGoodStore,
  describeAssessment,
  hostReasoningFlag,
  hostToolsFlag,
  isLKGEntryCompatible,
  isNormallyPublishable,
  lastKnownGoodKey,
  metadataFailureFor,
  resolveConfigurationWithLKG,
  validateCapturedPublication,
  validateLastKnownGood,
  withheldReasons,
  PUBLICATION_SCHEMA_VERSION,
  type CompletenessAssessment,
  type LastKnownGoodEntry,
} from "../src/core/publication.ts"

const options = { contextTierCap: false, protocolOverrides: {} }

function group(
  modelName: string,
  model = `openai/${modelName}`,
  modelInfo: Record<string, unknown> = {},
): DeploymentGroup {
  return groupLiteLLMDeployments({
    data: [{
      model_name: modelName,
      litellm_params: { model },
      model_info: { mode: "chat", ...modelInfo },
    }],
  })[0]!
}

function assess(
  modelName: string,
  model: string | undefined,
  modelInfo: Record<string, unknown>,
  catalog: unknown,
): CompletenessAssessment {
  return assessModelConfiguration(group(modelName, model, modelInfo), catalog, options, { catalogAvailable: true })
}

function shape(models: Record<string, unknown>, providers: Record<string, unknown> = {}) {
  return {
    models,
    providers: Object.fromEntries(
      Object.entries(providers).map(([provider, records]) => [provider, { models: records }]),
    ),
  }
}

/** A group with no LiteLLM declarations: completeness depends on models.dev. */
function bareGroup(modelName: string, model?: string): DeploymentGroup {
  return group(modelName, model)
}

const COMPLETE_INFO = {
  max_input_tokens: 200000,
  max_output_tokens: 32000,
  supports_function_calling: true,
  supports_reasoning: false,
  supports_vision: false,
  supports_pdf_input: false,
  supports_audio_input: false,
  supports_video_input: false,
  supports_audio_output: false,
}

const COMPLETE_ENTRY = {
  limit: { context: 200000, input: 200000, output: 32000 },
  modalities: { input: ["text"], output: ["text"] },
  tool_call: true,
  reasoning: false,
}

// ---------------------------------------------------------------------------
// Normal match (catalog shape)
// ---------------------------------------------------------------------------

describe("publication: normal match", () => {
  test("registry identity with complete LiteLLM declarations is publishable", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY })
    const result = assess("x", "x", COMPLETE_INFO, catalog)
    expect(result.publishable).toBeTrue()
    expect(result.status).toBe("configured")
    expect(result.missingFields).toEqual([])
    expect(result.illegalFields).toEqual([])
    expect(result.resolvedIdentity?.canonicalModelID).toBe("labA/x")
  })

  test("qualified route proves the same registry entry", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY })
    const result = assess("m", "labA/x", COMPLETE_INFO, catalog)
    expect(result.publishable).toBeTrue()
    expect(result.resolvedIdentity?.evidence).toBe("qualified-deployment")
  })

  test("declared serving record resolves with serving basis", () => {
    const catalog = shape(
      { "labA/x": COMPLETE_ENTRY },
      { labA: { x: { id: "x", limit: { context: 100, input: 90, output: 10 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } } },
    )
    const detailed = selectModelsDevRecordDetailed(group("x", "x", { models_dev_provider: "labA" }), catalog)
    expect(detailed.outcome).toBe("matched")
    expect(detailed.selected?.selectionSource).toBe("explicit-provider")
    const result = assess("x", "x", { ...COMPLETE_INFO, models_dev_provider: "labA" }, catalog)
    expect(result.publishable).toBeTrue()
    expect(result.fieldBasis?.["limit.context"]).toBe("serving")
  })

  test("unproven records never match, however exact the id", () => {
    const catalog = shape(
      {},
      {
        opencode: { x: { id: "x", limit: { context: 999, output: 99 } } },
        openrouter: { x: { id: "x", limit: { context: 888, output: 88 } } },
      },
    )
    expect(selectModelsDevRecord(group("x", "x"), catalog)).toBeUndefined()
    expect(selectModelsDevRecordDetailed(group("x", "x"), catalog).outcome).toBe("unmatched")
  })

  test("provenance names the deciding source", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY })
    const result = assess("x", "x", COMPLETE_INFO, catalog)
    expect(result.context.provenance.detail).toContain("labA/x")
  })
})

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

describe("publication: reasoning", () => {
  test("registry reasoning verdict with LiteLLM agreement", () => {
    const catalog = shape({ "labA/x": { ...COMPLETE_ENTRY, reasoning: true } })
    const result = assess("x", "x", { ...COMPLETE_INFO, supports_reasoning: true }, catalog)
    expect(result.reasoning.state).toBe("supported")
    expect(result.publishable).toBeTrue()
  })

  test("reasoning disagreement across deployments stays unknown", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY })
    const litellm = {
      data: [
        { model_name: "x", litellm_params: { model: "x" }, model_info: { mode: "chat", ...COMPLETE_INFO, supports_reasoning: true } },
        { model_name: "x", litellm_params: { model: "x" }, model_info: { mode: "chat", ...COMPLETE_INFO, supports_reasoning: false } },
      ],
    }
    const result = assessModelConfiguration(groupLiteLLMDeployments(litellm)[0]!, catalog, options, { catalogAvailable: true })
    expect(result.reasoning.state).toBe("unknown")
    expect(result.publishable).toBeFalse()
  })

  test("no reasoning evidence stays unknown, never false", () => {
    const result = assess("x", "x", {}, shape({}))
    expect(resolveReasoningState(group("x", "x"), undefined).state).toBe("unknown")
    expect(result.reasoning.state).toBe("unknown")
  })
})

// ---------------------------------------------------------------------------
// Group identity
// ---------------------------------------------------------------------------

describe("publication: group identity", () => {
  function multi(modelName: string, deployments: Array<{ model?: string; info?: Record<string, unknown> }>) {
    return groupLiteLLMDeployments({
      data: deployments.map((item) => ({
        model_name: modelName,
        litellm_params: { model: item.model ?? `openai/${modelName}` },
        model_info: { mode: "chat", ...(item.info ?? {}) },
      })),
    })[0]!
  }

  test("conflicting explicit providers are ambiguous, never first-wins", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY })
    const g = groupLiteLLMDeployments({
      data: [
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", models_dev_provider: "a" } },
        { model_name: "m", litellm_params: { model: "x" }, model_info: { mode: "chat", models_dev_provider: "b" } },
      ],
    })[0]!
    expect(assessModelConfiguration(g, catalog, options, { catalogAvailable: true }).status).toBe("ambiguous")
  })

  test("deployments resolving to different entries stay ambiguous", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY, "labB/y": COMPLETE_ENTRY })
    const g = multi("m", [{ model: "labA/x" }, { model: "labB/y" }])
    expect(assessModelConfiguration(g, catalog, options, { catalogAvailable: true }).status).toBe("ambiguous")
  })

  test("same registry entry from different routes resolves deterministically", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY })
    const g = multi("m", [{ model: "x" }, { model: "labA/x" }])
    const assessment = assessModelConfiguration(g, catalog, options, { catalogAvailable: true })
    // Bare + qualified prove the same entry; LiteLLM declarations are absent
    // so the model is incomplete — but identity itself is proven, not ambiguous.
    expect(assessment.resolvedIdentity?.status).toBe("proven")
    expect(assessment.resolvedIdentity?.canonicalModelID).toBe("labA/x")
  })

  test("provider-qualified identities keep their namespace without proof", () => {
    const catalog = shape({})
    for (const deployments of [
      [{ model: "openai/foo" }, { model: "anthropic/foo" }],
      [{ model: "anthropic/foo" }, { model: "openai/foo" }],
    ]) {
      const g = multi("shared", deployments)
      expect(groupIdentityConflict(g, catalog)).toContain("cannot be proven")
    }
  })

  test("group identity requires positive evidence for every deployment", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY })
    const identified = { model_name: "m", litellm_params: { model: "labA/x" }, model_info: { mode: "chat", ...COMPLETE_INFO } }
    const identityLess = { model_name: "m", litellm_params: {}, model_info: { mode: "chat", ...COMPLETE_INFO } }
    for (const data of [[identified, identityLess], [identityLess, identified]]) {
      const g = groupLiteLLMDeployments({ data })[0]!
      const assessment = assessModelConfiguration(g, catalog, options, { catalogAvailable: true })
      expect(assessment.publishable).toBeFalse()
    }
  })
})

// ---------------------------------------------------------------------------
// Withheld reasons / failure taxonomy
// ---------------------------------------------------------------------------

describe("publication: withheld reasons", () => {
  test("ambiguous identity reports identity-ambiguous", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY, "labB/x": COMPLETE_ENTRY })
    const result = assess("m", "x", COMPLETE_INFO, catalog)
    expect(result.status).toBe("ambiguous")
    expect(withheldReasons(result).map((reason) => reason.code)).toContain("identity-ambiguous")
  })

  test("incomplete metadata lists gaps", () => {
    const result = assess("m", "m", {}, shape({}))
    expect(result.status).not.toBe("configured")
    expect(withheldReasons(result).length).toBeGreaterThan(0)
  })

  test("publishable assessments carry no reasons", () => {
    const result = assess("x", "x", COMPLETE_INFO, shape({ "labA/x": COMPLETE_ENTRY }))
    expect(withheldReasons(result)).toEqual([])
  })

  test("metadata failures classify without defaults", () => {
    expect(classifyMetadataFailure(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" })).kind).toBe("unreachable")
    expect(classifyMetadataFailure({ status: 503 }).kind).toBe("server-5xx")
    expect(classifyMetadataFailure({ status: 404 }).kind).toBe("not-found")
    expect(metadataFailureFor("timeout").retryable).toBeTrue()
  })

  test("illegal declared values stay illegal with a complete registry", () => {
    const catalog = shape({ "labA/x": COMPLETE_ENTRY })
    const result = assess("x", "x", { ...COMPLETE_INFO, max_output_tokens: -5 }, catalog)
    expect(result.status).toBe("invalid-metadata")
    expect(result.illegalFields).toContain("limit.output")
  })

  test("describeAssessment and host flags", () => {
    const good = assess("x", "x", COMPLETE_INFO, shape({ "labA/x": COMPLETE_ENTRY }))
    expect(describeAssessment(good)).toContain("configured")
    expect(isNormallyPublishable(good.status)).toBeTrue()
    expect(hostReasoningFlag(good)).toBeFalse()
    expect(hostToolsFlag(good, true)).toBeTrue()
    expect(lastKnownGoodKey("  My_Model ")).toBe("my-model")
  })
})

// ---------------------------------------------------------------------------
// Group limit evidence (dimension isolation)
// ---------------------------------------------------------------------------

describe("publication: group limit evidence", () => {
  const base = { ...COMPLETE_INFO }
  function two(modelName: string, first: Record<string, unknown>, second: Record<string, unknown>) {
    return groupLiteLLMDeployments({
      data: [
        { model_name: modelName, litellm_params: { model: modelName }, model_info: { mode: "chat", ...first } },
        { model_name: modelName, litellm_params: { model: modelName }, model_info: { mode: "chat", ...second } },
      ],
    })[0]!
  }

  test("max_input_tokens never becomes context; disagreement affects input only", () => {
    const same = assessModelConfiguration(two("m", { ...base, max_input_tokens: 128000 }, { max_input_tokens: 128000 }), {}, options)
    // LiteLLM-only: max_input_tokens IS the private-model context declaration.
    expect(same.context).toMatchObject({ value: 128000, valid: true })

    const differing = assessModelConfiguration(two("m", { ...base, max_input_tokens: 128000 }, { max_input_tokens: 64000 }), {}, options)
    expect(differing.conflicts.map((item) => item.field)).toContain("limit.input")
    expect(differing.conflicts.map((item) => item.field)).not.toContain("limit.context")
  })

  test("partial input declarations stay unknown, never coerced", () => {
    const partial = assessModelConfiguration(
      two("m", { ...base, max_input_tokens: 128000 }, { ...base }),
      shape({ "labA/m": { limit: { context: 128000, output: 32000 } } }),
      options,
    )
    expect(partial.fieldBasis?.["limit.input"]).toBe("unknown")
  })

  test("output disagreement is an unresolved conflict under every branch", () => {
    const catalog = shape({ "labA/m": { limit: { context: 128000, output: 32000 } } })
    const conflicted = assessModelConfiguration(
      two("m", { ...base, max_output_tokens: 16000 }, { ...base, max_output_tokens: 8000 }),
      catalog,
      options,
    )
    expect(conflicted.status).toBe("invalid-metadata")
    expect(conflicted.conflicts.map((item) => item.field)).toContain("limit.output")
  })
})

// ---------------------------------------------------------------------------
// Modality completeness (registry complete sets)
// ---------------------------------------------------------------------------

describe("publication: modality completeness", () => {
  const modalityCatalog = shape({
    "labA/text-only": { limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } },
    "labA/image-model": { limit: { context: 100, output: 10 }, tool_call: true, reasoning: false, modalities: { input: ["text", "image"], output: ["text"] } },
  })

  test("explicit registry text-only is known and publishable", () => {
    const result = assessModelConfiguration(group("text-only", "text-only"), modalityCatalog, options)
    expect(result.inputModalities.known).toBeTrue()
  })

  test("sparse LiteLLM flags alone never complete a direction", () => {
    const result = assessModelConfiguration(
      group("m", "m", { supports_vision: true, supports_audio_output: false }),
      shape({}),
      options,
    )
    expect(result.inputModalities.known).toBeFalse()
    expect(result.inputModalities.values).toEqual([])
  })

  test("registry image set decides; names never infer modalities", () => {
    const image = assessModelConfiguration(group("image-model", "image-model"), modalityCatalog, options)
    expect(image.inputModalities.known).toBeTrue()
    expect([...image.inputModalities.values].sort()).toEqual(["image", "text"])
  })
})

// ---------------------------------------------------------------------------
// LKG schema 8 (capture / validate / restore)
// ---------------------------------------------------------------------------

describe("publication: LKG schema 8", () => {
  const doc = shape({ "labA/m": { limit: { context: 100000, input: 90000, output: 10000 }, modalities: { input: ["text"], output: ["text"] }, tool_call: true, reasoning: false } })
  const liveBody = {
    data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", ...COMPLETE_INFO, max_input_tokens: 90000, max_output_tokens: 10000 } }],
  }
  function seed(): { group: DeploymentGroup; entry: LastKnownGoodEntry } {
    const g = groupLiteLLMDeployments(liveBody)[0]!
    const publication = buildPublicationResult(liveBody, doc, options)
    const live = publication.publishable.find((item) => item.spec.id === "m")!
    const entry = createLastKnownGoodEntry(g, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), doc, options)
    return { group: g, entry }
  }

  test("capture stores schema 8 with a full proof composition", () => {
    const { entry } = seed()
    expect(entry.schemaVersion).toBe(8)
    expect(PUBLICATION_SCHEMA_VERSION).toBe(8)
    expect(isLKGEntryCompatible(entry)).toBeTrue()
    expect(entry.proof.deploymentEvidence.length).toBe(1)
    expect(entry.proof.deploymentEvidence[0]!.identityKind).toBe("canonical")
    expect(typeof entry.proof.registryDigest).toBe("string")
    expect(validateCapturedPublication(entry).valid).toBeTrue()
  })

  test("withheld resolutions never capture", () => {
    const g = groupLiteLLMDeployments(liveBody)[0]!
    expect(() => createLastKnownGoodEntry(
      g, undefined,
      { id: "m", name: "m", protocol: "chat", capabilities: { tools: false, input: ["text"], output: ["text"] }, variants: [], released: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, limit: { context: 0, input: 0, output: 0 } },
      Date.now(), undefined, doc, options,
    )).toThrow()
  })

  test("valid entry restores through an outage with the whole spec", () => {
    const { group: g, entry } = seed()
    void g
    const store = createLastKnownGoodStore()
    store.set("m", entry)
    const outage = buildPublicationResult(liveBody, {}, options, { store })
    // Live LiteLLM declares vision only... COMPLETE_INFO declares every
    // modality flag, so outage-live stays configured without LKG. Use a
    // partial declaration instead.
    void outage
    const partialBody = {
      data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", max_input_tokens: 90000, max_output_tokens: 10000, supports_function_calling: true, supports_reasoning: false, supports_vision: true } }],
    }
    const partialGroup = groupLiteLLMDeployments(partialBody)[0]!
    const partialPublication = buildPublicationResult(partialBody, doc, options)
    const partialLive = partialPublication.publishable.find((item) => item.spec.id === "m")!
    const partialEntry = createLastKnownGoodEntry(partialGroup, undefined, partialLive.spec, Date.now(), capturedPublicationVerdict(partialLive.assessment, partialLive.spec), doc, options)
    const partialStore = createLastKnownGoodStore()
    partialStore.set("m", partialEntry)
    const restored = buildPublicationResult(partialBody, {}, options, { store: partialStore })
    expect(restored.publishable.find((item) => item.spec.id === "m")?.spec).toEqual(partialLive.spec)
    expect(restored.publishable.find((item) => item.spec.id === "m")?.assessment.status).toBe("configured-lkg")
  })

  test("changed deployments reject the entry; operator-config changes do not", () => {
    const { entry } = seed()
    const changed = groupLiteLLMDeployments({
      data: [{ model_name: "m", litellm_params: { model: "other" }, model_info: { mode: "chat", ...COMPLETE_INFO, max_input_tokens: 90000, max_output_tokens: 10000 } }],
    })[0]!
    expect(validateLastKnownGood(entry, changed, undefined, Date.now(), options, {}).valid).toBeFalse()

    const reconfigured = groupLiteLLMDeployments({
      data: [{ model_name: "m", litellm_params: { model: "m", max_tokens: 5 }, model_info: { mode: "chat", ...COMPLETE_INFO, max_input_tokens: 90000, max_output_tokens: 10000 } }],
    })[0]!
    expect(validateLastKnownGood(entry, reconfigured, undefined, Date.now(), options, {}).valid).toBeTrue()
  })

  test("schema 7 entries fail closed without migration", () => {
    const { group: g, entry } = seed()
    void g
    expect(validateLastKnownGood({ ...entry, schemaVersion: 7 } as never, groupLiteLLMDeployments(liveBody)[0]!, undefined, Date.now(), options, {}).valid).toBeFalse()
  })

  test("resolveConfigurationWithLKG only substitutes incomplete/unavailable assessments", () => {
    const { group: g, entry } = seed()
    const store = createLastKnownGoodStore()
    store.set("m", entry)
    const live = assessModelConfiguration(g, doc, options, { catalogAvailable: true })
    // Publishable assessments never consult LKG.
    expect(resolveConfigurationWithLKG(live, g, doc, options, store).lkg).toBeUndefined()
    // Incomplete assessments restore the whole stored spec: use a group
    // whose LiteLLM declarations are partial (modalities unknown without
    // the registry), so outage-live is genuinely incomplete.
    const partialGroup = groupLiteLLMDeployments({
      data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", max_input_tokens: 90000, max_output_tokens: 10000, supports_function_calling: true, supports_reasoning: false, supports_vision: true } }],
    })[0]!
    const partialPublication = buildPublicationResult(
      { data: [{ model_name: "m", litellm_params: { model: "m" }, model_info: { mode: "chat", max_input_tokens: 90000, max_output_tokens: 10000, supports_function_calling: true, supports_reasoning: false, supports_vision: true } }] },
      doc, options,
    )
    const partialLive = partialPublication.publishable.find((item) => item.spec.id === "m")!
    const partialEntry = createLastKnownGoodEntry(
      partialGroup, undefined, partialLive.spec, Date.now(),
      capturedPublicationVerdict(partialLive.assessment, partialLive.spec), doc, options,
    )
    const partialStore = createLastKnownGoodStore()
    partialStore.set("m", partialEntry)
    const incomplete = assessModelConfiguration(partialGroup, {}, options, { catalogAvailable: false })
    expect(incomplete.publishable).toBeFalse()
    const substituted = resolveConfigurationWithLKG(
      { ...incomplete, status: "metadata-unavailable" },
      partialGroup, {}, options, partialStore,
    )
    expect(substituted.assessment.status).toBe("configured-lkg")
    expect(substituted.lkg?.spec).toEqual(partialLive.spec)
  })
})

// ---------------------------------------------------------------------------
// Publication result partition
// ---------------------------------------------------------------------------

describe("publication: result partition", () => {
  test("configured and configured-lkg publish; everything else is blocked", () => {
    const doc = shape({ "labA/good": { ...COMPLETE_ENTRY } })
    const body = {
      data: [
        { model_name: "good", litellm_params: { model: "good" }, model_info: { mode: "chat", ...COMPLETE_INFO } },
        { model_name: "bad", litellm_params: { model: "bad" }, model_info: { mode: "chat" } },
      ],
    }
    const result = buildPublicationResult(body, doc, options)
    expect(result.publishable.map((item) => item.spec.id)).toEqual(["good"])
    expect(result.blocked.map((item) => item.spec.id)).toEqual(["bad"])
    expect(result.assessments.size).toBe(2)
  })

  test("removed models never resurrect from LKG", () => {
    const doc = shape({ "labA/good": { ...COMPLETE_ENTRY } })
    const body = {
      data: [
        { model_name: "good", litellm_params: { model: "good" }, model_info: { mode: "chat", ...COMPLETE_INFO } },
      ],
    }
    const g = groupLiteLLMDeployments(body)[0]!
    const publication = buildPublicationResult(body, doc, options)
    const live = publication.publishable[0]!
    const store = createLastKnownGoodStore()
    store.set("good", createLastKnownGoodEntry(g, undefined, live.spec, Date.now(), capturedPublicationVerdict(live.assessment, live.spec), doc, options))
    // LiteLLM no longer serves "good": it appears nowhere, LKG or not.
    const gone = buildPublicationResult({ data: [] }, {}, options, { store })
    expect(gone.publishable).toEqual([])
    expect(gone.blocked).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fixture verdicts (canonical-shape spots; depth lives in acceptance tests)
// ---------------------------------------------------------------------------

describe("publication: fixture regression", () => {
  test("fixture models keep their publishability verdicts", () => {
    const result = buildPublicationResult(litellmFixture, {}, options)
    // With an unavailable catalog, only LiteLLM-complete models publish.
    for (const entry of result.publishable) {
      expect(entry.assessment.status === "configured" || entry.assessment.status === "configured-lkg").toBeTrue()
    }
    for (const entry of result.blocked) {
      expect(entry.assessment.publishable).toBeFalse()
    }
    expect(result.publishable.length + result.blocked.length).toBeGreaterThan(0)
  })
})
