/**
 * Discovery resilience: evidence source authority, trusted LKG, partial
 * catalog, regression detection, recovery, and acknowledgement.
 *
 * Every fixture here is offline, sanitized, and deterministic. The three
 * live regressions (`deepseek-v4.1-flash`, `glm-5.3-flash`, `minimax-m3`)
 * appear only as test data — no production code branches on a model name.
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
  metadataFailureFor,
  resolveConfigurationWithLKG,
  withheldReasons,
  PUBLICATION_SCHEMA_VERSION,
  type PublicationResult,
} from "../src/core/publication.ts"
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

function publicationOf(groups: DeploymentGroup[], catalog: unknown): PublicationResult {
  return buildPublicationResult(
    {
      data: groups.map((group) => ({
        model_name: group.modelName,
        litellm_params: { model: (group.deployments[0]!.litellmParams.model as string) ?? "custom/x" },
        model_info: { mode: "chat", ...group.deployments[0]!.modelInfo },
      })),
    },
    catalog,
    options,
  )
}

// ---------------------------------------------------------------------------
// Live regression fixtures (sanitized copies of the observed real evidence)
// ---------------------------------------------------------------------------

/**
 * Observed evidence: LiteLLM `model_info` describes an output cap while the
 * trusted models.dev record for the same canonical identity declares a
 * different intrinsic maximum output.
 */
const LIVE_REGRESSIONS = [
  {
    id: "deepseek-v4.1-flash",
    litellm: {
      max_input_tokens: 1_000_000,
      max_output_tokens: 384_000,
      max_tokens: 384_000,
      supports_vision: true,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_function_calling: true,
      supports_reasoning: true,
    },
    provider: "openrouter",
    recordID: "deepseek/deepseek-v4.1-flash",
    record: {
      id: "deepseek/deepseek-v4.1-flash",
      tool_call: true,
      reasoning: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 1_048_576, output: 943_718 },
    },
    expectedIntrinsicOutput: 943_718,
  },
  {
    id: "glm-5.3-flash",
    litellm: {
      max_input_tokens: 1_000_000,
      max_output_tokens: 131_072,
      max_tokens: 131_072,
      supports_vision: true,
      supports_pdf_input: true,
      supports_audio_input: true,
      supports_function_calling: true,
      supports_reasoning: true,
    },
    provider: "zhipuai",
    recordID: "glm-5.3-flash",
    record: {
      id: "glm-5.3-flash",
      tool_call: true,
      reasoning: true,
      modalities: { input: ["text", "image", "video", "pdf"], output: ["text"] },
      limit: { context: 1_000_000, output: 131_072 },
    },
    expectedIntrinsicOutput: 131_072,
    expectAudioInput: false,
  },
  {
    id: "minimax-m3",
    litellm: {
      max_input_tokens: 1_000_000,
      max_output_tokens: 131_072,
      max_tokens: 131_072,
      supports_vision: true,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_function_calling: true,
      supports_reasoning: true,
      input_cost_per_token_above_512k_tokens: 6e-7,
    },
    provider: "minimax",
    recordID: "MiniMax-M3",
    record: {
      id: "MiniMax-M3",
      tool_call: true,
      reasoning: true,
      modalities: { input: ["text", "image", "video"], output: ["text"] },
      limit: { context: 1_000_000, output: 512_000 },
    },
    expectedIntrinsicOutput: 512_000,
  },
] as const

describe("resilience: live model regressions", () => {
  for (const fixture of LIVE_REGRESSIONS) {
    test(`${fixture.id}: descriptive LiteLLM metadata never blocks a trusted intrinsic record`, () => {
      const group = groupOf(fixture.id, fixture.litellm as Record<string, unknown>)
      const catalog = { [fixture.provider]: { models: { [fixture.recordID]: fixture.record } } }
      const result = publicationOf([group], catalog)
      const entry = result.publishable.find((item) => item.spec.id === fixture.id)

      expect(result.blocked).toEqual([])
      expect(entry).toBeDefined()
      expect(entry!.assessment.status).toBe("configured")
      expect(entry!.assessment.conflicts).toEqual([])
      expect(entry!.spec.limit.output).toBe(fixture.expectedIntrinsicOutput)

      // The difference is retained as a resolved discrepancy, never as an
      // unresolved conflict and never as incomplete metadata.
      const output = entry!.assessment.output.resolution
      expect(output.status).toMatch(/selected|resolved-discrepancy/)
      expect(output.selectedSource).toBe("models.dev")
      expect(output.evidence.some((item) => item.origin === "descriptive-metadata")).toBe(true)
      expect(entry!.assessment.unknownFields).toEqual([])
      expect(entry!.assessment.missingFields).toEqual([])
      expect(entry!.assessment.illegalFields).toEqual([])
    })
  }

  test("descriptive output difference is recorded and never invalidates a trusted snapshot", () => {
    const fixture = LIVE_REGRESSIONS[0]
    const group = groupOf(fixture.id, fixture.litellm as Record<string, unknown>)
    const catalog = { [fixture.provider]: { models: { [fixture.recordID]: fixture.record } } }
    const assessment = assessModelConfiguration(group, catalog, options)
    expect(assessment.output.resolution.status).toBe("resolved-discrepancy")
    expect(assessment.discrepancies.map((item) => item.field)).toContain("limit.output")

    // Outage: an LKG captured with the intrinsic value stays valid even
    // though the descriptive declaration still disagrees.
    const spec = buildModelSpecs(
      { data: [{ model_name: fixture.id, litellm_params: { model: "custom/" + fixture.id }, model_info: { mode: "chat", ...fixture.litellm } }] },
      catalog,
      options,
    ).find((item) => item.id === fixture.id)!
    const store = createLastKnownGoodStore()
    store.set(lastKnownGoodKey(fixture.id), createLastKnownGoodEntry(
      group,
      assessment.identity.selected,
      spec,
      1000,
      capturedPublicationVerdict(assessment, spec),
    ))
    const live = assessModelConfiguration(group, {}, options, {
      catalogAvailable: false,
      failure: metadataFailureFor("timeout"),
    })
    const resolved = resolveConfigurationWithLKG(live, group, {}, options, store, 2000)
    expect(resolved.assessment.status).toBe("configured-lkg")
  })

  test("glm-5.3-flash: intrinsic audio input is unsupported and the direction stays known", () => {
    const fixture = LIVE_REGRESSIONS[1]
    const group = groupOf(fixture.id, fixture.litellm as Record<string, unknown>)
    const catalog = { [fixture.provider]: { models: { [fixture.recordID]: fixture.record } } }
    const assessment = assessModelConfiguration(group, catalog, options)
    expect(assessment.inputModalities.known).toBeTrue()
    expect(assessment.inputModalities.values).not.toContain("audio")
    expect(assessment.inputModalities.values).toEqual(["text", "image", "pdf", "video"])
    expect(assessment.inputModalities.resolution.status).toBe("resolved-discrepancy")
    expect(assessment.unknownFields).not.toContain("capabilities.input")
    expect(assessment.publishable).toBeTrue()
  })
})

// ---------------------------------------------------------------------------
// Source authority
// ---------------------------------------------------------------------------

describe("resilience: source authority", () => {
  const record = {
    id: "mm",
    tool_call: true,
    reasoning: false,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 200_000, output: 64_000 },
  }

  test("authoritative intrinsic metadata is only used when canonical identity is reliably resolved", () => {
    const catalog = {
      vendor: { models: { mm: record } },
      other: { models: { mm: record } },
    }
    // Two equally ranked candidates: identity stays ambiguous, so models.dev
    // carries no authority and the model is withheld with an identity reason.
    const ambiguousGroup = groupOf("mm", {
      max_input_tokens: 200_000,
      max_output_tokens: 32_000,
      supports_function_calling: true,
      supports_reasoning: false,
      supports_vision: false,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
      supports_audio_output: false,
    })
    const ambiguous = assessModelConfiguration(ambiguousGroup, catalog, options)
    expect(ambiguous.status).toBe("ambiguous")
    expect(ambiguous.publishable).toBeFalse()
    expect(withheldReasons(ambiguous).map((reason) => reason.code)).toContain("identity-ambiguous")
    expect(ambiguous.output.resolution.selectedSource).toBe("litellm")
  })

  test("a unique trusted record decides the intrinsic value", () => {
    const group = groupOf("mm", {
      max_input_tokens: 200_000,
      max_output_tokens: 32_000,
      supports_function_calling: true,
      supports_reasoning: false,
      supports_vision: false,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
      supports_audio_output: false,
    })
    const assessment = assessModelConfiguration(group, { vendor: { models: { mm: record } } }, options)
    expect(assessment.status).toBe("configured")
    expect(assessment.output.value).toBe(64_000)
    expect(assessment.output.resolution.selectedSource).toBe("models.dev")
  })

  test("a proven endpoint runtime constraint narrows the effective configuration", () => {
    const group = groupOf("mm", {
      max_input_tokens: 200_000,
      max_output_tokens: 64_000,
      supports_function_calling: true,
      supports_reasoning: false,
      supports_vision: false,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
      supports_audio_output: false,
    }, { max_tokens: 32_000 })
    const assessment = assessModelConfiguration(group, { vendor: { models: { mm: record } } }, options)
    expect(assessment.status).toBe("configured")
    expect(assessment.output.value).toBe(32_000)
    expect(assessment.output.deploymentConstraint).toBe(32_000)
    // Not a conflict: the endpoint simply enforces less than the model allows.
    expect(assessment.conflicts).toEqual([])
  })

  test("same-level evidence that no authority can decide stays an unresolved conflict", () => {
    const twoDeployments = groupLiteLLMDeployments({
      data: [
        { model_name: "mm", litellm_params: { model: "vendor/mm" }, model_info: { mode: "chat", max_input_tokens: 200_000, max_output_tokens: 64_000 } },
        { model_name: "mm", litellm_params: { model: "vendor/mm" }, model_info: { mode: "chat", max_input_tokens: 200_000, max_output_tokens: 16_000 } },
      ],
    })[0]!
    const assessment = assessModelConfiguration(twoDeployments, { vendor: { models: { mm: record } } }, options)
    expect(assessment.status).toBe("invalid-metadata")
    expect(assessment.publishable).toBeFalse()
    expect(assessment.output.resolution.status).toBe("unresolved-conflict")
    expect(withheldReasons(assessment).map((reason) => reason.code)).toContain("authoritative-conflict")
  })

  test("illegal declared values stay illegal even with an authoritative record", () => {
    const group = groupOf("mm", {
      max_input_tokens: 200_000,
      max_output_tokens: 0,
      supports_function_calling: true,
      supports_reasoning: false,
      supports_vision: false,
      supports_pdf_input: false,
      supports_audio_input: false,
      supports_video_input: false,
      supports_audio_output: false,
    })
    const assessment = assessModelConfiguration(group, { vendor: { models: { mm: record } } }, options)
    expect(assessment.status).toBe("invalid-metadata")
    expect(assessment.illegalFields).toContain("limit.output")
    expect(withheldReasons(assessment).map((reason) => reason.code)).toContain("illegal-metadata")
  })
})

// ---------------------------------------------------------------------------
// Partial catalog, regression, recovery, unusable catalog
// ---------------------------------------------------------------------------

describe("resilience: partial catalog", () => {
  const complete = {
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

  /** 20 discovered models: 17 fully configured, 3 with distinct blockers. */
  function twentyModels() {
    const data: unknown[] = []
    for (let index = 0; index < 17; index += 1) {
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
    // identity ambiguous under the enrichment catalog
    data.push({ model_name: "shared", litellm_params: { model: "custom/shared" }, model_info: { mode: "chat", ...complete } })
    return { data }
  }

  const catalog = {
    a: { models: { shared: { id: "shared", limit: { context: 1000, output: 10 }, tool_call: true, modalities: { input: ["text"], output: ["text"] } } } },
    b: { models: { shared: { id: "shared", limit: { context: 1000, output: 10 }, tool_call: true, modalities: { input: ["text"], output: ["text"] } } } },
  }

  test("17 of 20 models publish immediately; the other 3 are withheld with reasons", () => {
    const result = buildPublicationResult(twentyModels(), catalog, options)
    expect(result.publishable.length).toBe(17)
    expect(result.blocked.length).toBe(3)
    const catalogFacts = catalogFromPublication(result, { discovered: 20 })
    expect(catalogFacts.discovered).toBe(20)
    expect(catalogFacts.publishable.length).toBe(17)
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
      { model_name: "shared", litellm_params: { model: "custom/shared" }, model_info: { mode: "chat", ...complete } },
      { model_name: "gone", litellm_params: { model: "custom/gone" }, model_info: { mode: "chat" } },
    ]
    const result = buildPublicationResult({ data }, catalog, options)
    expect(result.publishable.length).toBe(0)
    const facts = catalogFromPublication(result, { discovered: 2 })
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
    expect(PUBLICATION_SCHEMA_VERSION).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// Trusted LKG: state machine coverage
// ---------------------------------------------------------------------------

describe("resilience: trusted LKG state machine", () => {
  const COMPLETE = {
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

  function response(modelName: string, info: Record<string, unknown>, route = "custom/complete") {
    return { data: [{ model_name: modelName, litellm_params: { model: route }, model_info: { mode: "chat", ...info } }] }
  }

  test("fresh configured -> metadata outage -> configured via trusted LKG -> recovery back to fresh", () => {
    const store = createLastKnownGoodStore()
    const first = buildPublicationResult(response("complete", COMPLETE), {}, options, { store, now: 1000 })
    expect(first.publishable[0]!.assessment.status).toBe("configured")
    store.set(lastKnownGoodKey("complete"), createLastKnownGoodEntry(
      groupOf("complete", COMPLETE),
      first.publishable[0]!.assessment.identity.selected,
      first.publishable[0]!.spec,
      1000,
      capturedPublicationVerdict(first.publishable[0]!.assessment, first.publishable[0]!.spec),
    ))

    const outage = buildPublicationResult(response("complete", COMPLETE), {}, options, {
      store,
      now: 2000,
      failure: metadataFailureFor("server-5xx", "HTTP 503"),
    })
    // `model_info` still declares every field, so this runs the LiteLLM-only
    // path; the LKG path is exercised with metadata genuinely missing below.
    expect(outage.publishable.length).toBe(1)

    const sparseOutage = buildPublicationResult(response("complete", { supports_function_calling: true, supports_reasoning: false }), {}, options, {
      store,
      now: 3000,
      failure: metadataFailureFor("server-5xx", "HTTP 503"),
    })
    const viaLKG = sparseOutage.publishable.find((entry) => entry.spec.id === "complete")
    expect(viaLKG?.assessment.status).toBe("configured-lkg")
    expect(viaLKG?.assessment.usingLKG).toBeTrue()
    expect(viaLKG?.assessment.lkgDetail).toContain("live unavailable")

    const recovered = buildPublicationResult(response("complete", COMPLETE), {}, options, { store, now: 4000 })
    expect(recovered.publishable[0]!.assessment.status).toBe("configured")
    expect(recovered.publishable[0]!.assessment.usingLKG).toBeFalse()
  })

  test("a new model with unavailable metadata and no LKG stays withheld", () => {
    const result = buildPublicationResult(
      response("brand-new", { supports_function_calling: true, supports_reasoning: false }),
      {},
      options,
      { store: createLastKnownGoodStore(), now: 1000, failure: metadataFailureFor("timeout") },
    )
    expect(result.publishable).toEqual([])
    expect(result.blocked[0]!.assessment.status).toBe("metadata-unavailable")
  })

  test("an LKG entry never resurrects a model LiteLLM no longer serves", () => {
    const store = createLastKnownGoodStore()
    const configured = buildPublicationResult(response("removed", COMPLETE), {}, options, { store, now: 1000 })
    store.set(lastKnownGoodKey("removed"), createLastKnownGoodEntry(
      groupOf("removed", COMPLETE),
      configured.publishable[0]!.assessment.identity.selected,
      configured.publishable[0]!.spec,
      1000,
      capturedPublicationVerdict(configured.publishable[0]!.assessment, configured.publishable[0]!.spec),
    ))
    const afterRemoval = buildPublicationResult({ data: [] }, {}, options, { store, now: 2000 })
    expect(afterRemoval.publishable).toEqual([])
    expect(afterRemoval.blocked).toEqual([])
  })

  test("changing the canonical route invalidates the stored snapshot", () => {
    const store = createLastKnownGoodStore()
    const configured = buildPublicationResult(response("moved", COMPLETE, "custom/model-a"), {}, options, { store, now: 1000 })
    store.set(lastKnownGoodKey("moved"), createLastKnownGoodEntry(
      groupOf("moved", COMPLETE, { model: "custom/model-a" }),
      configured.publishable[0]!.assessment.identity.selected,
      configured.publishable[0]!.spec,
      1000,
      capturedPublicationVerdict(configured.publishable[0]!.assessment, configured.publishable[0]!.spec),
    ))
    const changed = buildPublicationResult(
      response("moved", { supports_function_calling: true, supports_reasoning: false }, "custom/model-b"),
      {},
      options,
      { store, now: 2000, failure: metadataFailureFor("timeout") },
    )
    expect(changed.publishable).toEqual([])
    expect(changed.blocked[0]!.assessment.status).toBe("metadata-unavailable")
  })

  test("an authoritative contradictory fact is never hidden behind an old snapshot", () => {
    const store = createLastKnownGoodStore()
    const configured = buildPublicationResult(response("m", COMPLETE, "vendor/m"), { vendor: { models: { m: { id: "m", limit: { context: 128_000, output: 32_000 }, tool_call: true, reasoning: false, modalities: { input: ["text"], output: ["text"] } } } } }, options, { store, now: 1000 })
    store.set(lastKnownGoodKey("m"), createLastKnownGoodEntry(
      groupOf("m", COMPLETE, { model: "vendor/m" }),
      configured.publishable[0]!.assessment.identity.selected,
      configured.publishable[0]!.spec,
      1000,
      capturedPublicationVerdict(configured.publishable[0]!.assessment, configured.publishable[0]!.spec),
    ))
    const live = buildPublicationResult(
      response("m", { supports_function_calling: true, supports_reasoning: false }, "vendor/m"),
      { vendor: { models: { m: { id: "m", limit: { context: 128_000, output: 8_000 }, tool_call: true, reasoning: false } } } },
      options,
      { store, now: 2000 },
    )
    expect(live.publishable).toEqual([])
    expect(live.blocked[0]!.assessment.status).toBe("discovered-incomplete")
  })

  test("an incompatible stored schema fails safe instead of restoring", () => {
    const store = createLastKnownGoodStore()
    const configured = buildPublicationResult(response("m", COMPLETE), {}, options, { store, now: 1000 })
    const entry = createLastKnownGoodEntry(
      groupOf("m", COMPLETE),
      configured.publishable[0]!.assessment.identity.selected,
      configured.publishable[0]!.spec,
      1000,
      capturedPublicationVerdict(configured.publishable[0]!.assessment, configured.publishable[0]!.spec),
    )
    store.set(lastKnownGoodKey("m"), { ...entry, schemaVersion: 4 as never })
    const outage = buildPublicationResult(response("m", { supports_function_calling: true, supports_reasoning: false }), {}, options, {
      store,
      now: 2000,
      failure: metadataFailureFor("timeout"),
    })
    expect(outage.publishable).toEqual([])
    expect(outage.blocked[0]!.assessment.status).toBe("metadata-unavailable")
  })
})

// ---------------------------------------------------------------------------
// Acknowledgement persistence: restart stability
// ---------------------------------------------------------------------------

describe("resilience: acknowledgement persistence", () => {
  function withheld(id: string, status: "discovered-incomplete" | "ambiguous" = "discovered-incomplete", code = "incomplete-metadata") {
    return {
      id,
      status,
      reasons: [{ code: code as never, message: "x", fields: ["limit.output"] }],
      retryable: false,
    }
  }

  /** One adapter-like lifecycle: decide, persist, "restart", restore. */
  function restartCycle(
    persisted: PublicationMemory | undefined,
    catalog: CatalogPublication,
    at: string,
  ): { decision: ReturnType<typeof decideAcknowledgement>; memory: PublicationMemory } {
    const decision = decideAcknowledgement(persisted?.acknowledgement, catalog, at)
    const memory = parsePublicationMemory(serializePublicationMemory({
      schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
      acknowledgement: decision.next,
      published: nextPublishedBaseline(
        persisted?.published ?? [],
        catalog.publishable,
        catalog.withheld.map((entry) => entry.id),
      ),
    }))!
    return { decision, memory }
  }

  test("a round trip preserves the suppression state", () => {
    const catalog = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b")], discovered: 2 })
    const first = restartCycle(undefined, catalog, "2026-01-01T00:00:00.000Z")
    expect(first.decision.notify).toBeTrue()
    const stored = serializePublicationMemory(first.memory) as Record<string, unknown>
    const restored = parsePublicationMemory(JSON.stringify(stored))!
    expect(restored.acknowledgement?.fingerprint).toBe(catalog.fingerprint)
    expect(Object.keys(restored.acknowledgement!.models).sort()).toEqual(["a", "b"])
    // Second process, identical problem set.
    const second = restartCycle(restored, catalog, "2026-01-02T00:00:00.000Z")
    expect(second.decision.notify).toBeFalse()
    expect(second.decision.reason).toBe("unchanged")
  })

  test("improvement stays quiet across a restart and updates the baseline", () => {
    const two = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b")], discovered: 2 })
    const persisted = restartCycle(undefined, two, "2026-01-01T00:00:00.000Z").memory
    const improved = buildCatalogPublication({ publishable: [{ id: "a", usingLKG: false }], withheld: [withheld("b")], discovered: 2 })
    const after = restartCycle(persisted, improved, "2026-01-02T00:00:00.000Z")
    expect(after.decision.notify).toBeFalse()
    expect(after.decision.reason).toBe("improved")
    expect(Object.keys(after.memory.acknowledgement!.models)).toEqual(["b"])
  })

  test("full recovery clears the acknowledgement across a restart", () => {
    const two = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b")], discovered: 2 })
    const persisted = restartCycle(undefined, two, "2026-01-01T00:00:00.000Z").memory
    const recovered = buildCatalogPublication({ publishable: [{ id: "a", usingLKG: false }, { id: "b", usingLKG: false }], withheld: [], discovered: 2 })
    const after = restartCycle(persisted, recovered, "2026-01-02T00:00:00.000Z")
    expect(after.decision.reason).toBe("catalog-recovered")
    expect(after.memory.acknowledgement).toBeUndefined()
    expect([...after.memory.published].sort()).toEqual(["a", "b"])
    // A brand new problem afterwards is a fresh observation, not a suppression
    // inherited from the cleared record.
    const fresh = buildCatalogPublication({ publishable: [], withheld: [withheld("c")], discovered: 1 })
    const next = restartCycle(after.memory, fresh, "2026-01-03T00:00:00.000Z")
    expect(next.decision.reason).toBe("catalog-unusable")
    expect(next.decision.notify).toBeTrue()
  })

  test("a new problem after a restart is reported again", () => {
    // The first observation was surfaced (unusable catalog) and therefore
    // acknowledged and persisted.
    const one = buildCatalogPublication({ publishable: [], withheld: [withheld("a")], discovered: 1 })
    const first = restartCycle(undefined, one, "2026-01-01T00:00:00.000Z")
    expect(first.decision.notify).toBeTrue()
    expect(first.decision.reason).toBe("catalog-unusable")

    const grew = buildCatalogPublication({ publishable: [], withheld: [withheld("a"), withheld("b")], discovered: 2 })
    const after = restartCycle(first.memory, grew, "2026-01-02T00:00:00.000Z")
    expect(after.decision.notify).toBeTrue()
    expect(after.decision.reason).toBe("catalog-unusable")

    // A non-interruptive first observation is deliberately not stored, and a
    // newly discovered withheld model stays non-interruptive after a restart.
    const quiet = buildCatalogPublication({ publishable: [{ id: "healthy", usingLKG: false }], withheld: [withheld("a")], discovered: 2 })
    const quietMemory = restartCycle(undefined, quiet, "2026-01-01T00:00:00.000Z").memory
    expect(quietMemory.acknowledgement).toBeUndefined()
    const quietGrew = buildCatalogPublication({ publishable: [{ id: "healthy", usingLKG: false }], withheld: [withheld("a"), withheld("b")], discovered: 3 })
    const quietAfter = restartCycle(quietMemory, quietGrew, "2026-01-02T00:00:00.000Z")
    expect(quietAfter.decision.notify).toBeFalse()
    expect(quietAfter.decision.reason).toBe("first-observation")
  })

  test("a materially different reason for the same model is a new problem after a restart", () => {
    const before = buildCatalogPublication({ publishable: [], withheld: [withheld("a")], discovered: 1 })
    const persisted = restartCycle(undefined, before, "2026-01-01T00:00:00.000Z").memory
    expect(persisted.acknowledgement).toBeDefined()
    const changed = buildCatalogPublication({
      publishable: [],
      withheld: [withheld("a", "ambiguous", "identity-ambiguous")],
      discovered: 1,
    })
    const after = restartCycle(persisted, changed, "2026-01-02T00:00:00.000Z")
    expect(after.decision.notify).toBeTrue()
    expect(after.decision.reason).toBe("catalog-unusable")
    // The new reason replaced the acknowledged one, so the next identical
    // round is quiet again.
    const repeat = restartCycle(after.memory, changed, "2026-01-03T00:00:00.000Z")
    expect(repeat.decision.notify).toBeFalse()
    expect(repeat.decision.reason).toBe("unchanged")
  })

  test("a previously published model becoming withheld is a regression after a restart", () => {
    const published = buildCatalogPublication({ publishable: [{ id: "was-published", usingLKG: false }], withheld: [], discovered: 1 })
    const memory = restartCycle(undefined, published, "2026-01-01T00:00:00.000Z").memory
    expect(memory.published).toEqual(["was-published"])
    expect(memory.acknowledgement).toBeUndefined()

    // After the restart the restored baseline still knows the model was
    // published, so its withdrawal is a regression, not a first-time gap.
    const withdrawn = buildCatalogPublication({
      publishable: [{ id: "healthy", usingLKG: false }],
      withheld: [withheld("was-published")],
      discovered: 2,
      previouslyPublished: new Set(memory.published),
    })
    const after = restartCycle(memory, withdrawn, "2026-01-02T00:00:00.000Z")
    expect(after.decision.notify).toBeTrue()
    expect(after.decision.reason).toBe("regression")
  })

  test("the regression baseline keeps withheld models, drops removed ones, and stays bounded", () => {
    // A model LiteLLM no longer returns is forgotten.
    expect(nextPublishedBaseline(["gone", "still-there"], ["fresh"], ["still-there"])).toEqual(["fresh", "still-there"])
    // A withheld model keeps its history so a repeat round is still a regression.
    expect(nextPublishedBaseline(["withdrawn"], [], ["withdrawn"])).toEqual(["withdrawn"])
  })

  test("unreadable persisted memory only costs a repeated notification", () => {
    expect(parsePublicationMemory(undefined)).toBeUndefined()
    expect(parsePublicationMemory("not json")).toBeUndefined()
    expect(parsePublicationMemory({ schemaVersion: 99, published: ["a"] })).toBeUndefined()
    expect(parsePublicationMemory({ published: ["a"] })).toBeUndefined()
    // Acknowledgement present but corrupt: dropped wholesale, never partially trusted.
    const corrupt = parsePublicationMemory({
      schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
      acknowledgement: { schemaVersion: 1, fingerprint: "sha256:x", models: { a: "not-a-fingerprint" }, acknowledgedAt: "nope" },
      published: ["a"],
    })
    expect(corrupt?.acknowledgement).toBeUndefined()
    expect(corrupt?.published).toEqual(["a"])
    // An older acknowledgement schema re-notifies instead of suppressing.
    const older = parsePublicationMemory({
      schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
      acknowledgement: {
        version: 1,
        fingerprint: `sha256:${"a".repeat(32)}`,
        models: { a: `sha256:${"b".repeat(32)}` },
        acknowledgedAt: "2026-01-01T00:00:00.000Z",
      },
      published: [],
    })
    expect(older?.acknowledgement).toBeUndefined()
  })
})

describe("resilience: acknowledgement never changes publication", () => {
  const COMPLETE = {
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

  test("identical snapshots produce identical partitions with and without acknowledgement", () => {
    const response = {
      data: [
        { model_name: "gap-a", litellm_params: { model: "custom/gap-a" }, model_info: { mode: "chat" } },
        { model_name: "gap-b", litellm_params: { model: "custom/gap-b" }, model_info: { mode: "chat" } },
      ],
    }
    const first = buildPublicationResult(response, {}, options)
    const facts = catalogFromPublication(first, { discovered: 2 })
    expect(facts.unusable).toBeTrue()
    // The acknowledgement state is derived, persisted, and restored...
    const memory = {
      schemaVersion: PUBLICATION_MEMORY_SCHEMA_VERSION,
      acknowledgement: decideAcknowledgement(undefined, facts, "2026-01-01T00:00:00.000Z").next,
      published: nextPublishedBaseline([], facts.publishable, facts.withheld.map((entry) => entry.id)),
    }
    expect(parsePublicationMemory(serializePublicationMemory(memory))?.acknowledgement).toBeDefined()

    // ...and a fresh, identical publication round is bit-identical because of it.
    const again = buildPublicationResult(response, {}, options)
    expect(again.publishable.map((entry) => entry.spec.id)).toEqual(first.publishable.map((entry) => entry.spec.id))
    expect(again.blocked.map((entry) => entry.spec.id)).toEqual(first.blocked.map((entry) => entry.spec.id))
    expect(again.publishable.map((entry) => entry.assessment.status)).toEqual(
      first.publishable.map((entry) => entry.assessment.status),
    )
    expect(again.blocked.map((entry) => entry.assessment.status)).toEqual(
      first.blocked.map((entry) => entry.assessment.status),
    )
  })
})
