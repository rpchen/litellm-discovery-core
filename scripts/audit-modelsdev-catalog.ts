/** Optional catalog audit; the selected provider record supplies configuration. */
import { buildModelSpecs } from "../src/core/build.ts";
import { normalizeModelsDevCatalog } from "../src/core/catalog-input.ts";
import { groupLiteLLMDeployments } from "../src/core/litellm.ts";
import { buildPublicationResult } from "../src/core/publication.ts";
import { resolveModel } from "../src/core/resolve.ts";
const url = process.argv[2] ?? process.env.CATALOG_URL ?? "https://models.dev/catalog.json";
async function main(): Promise<void> {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`catalog fetch failed: HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const catalog = normalizeModelsDevCatalog(raw);
    if (catalog.kind !== "complete")
        throw new Error(`catalog is not complete (${catalog.kind})`);
    const results = Object.keys(catalog.models).map((name) => {
        const options = { contextTierCap: false, protocolOverrides: {} };
        const body = { data: [{ model_name: name, model_info: { mode: "chat" }, litellm_params: {} }] };
        const group = groupLiteLLMDeployments(body)[0]!;
        const resolved = resolveModel(group, raw);
        const built = buildModelSpecs(body, raw, options);
        const publication = buildPublicationResult(body, raw, options);
        if (JSON.stringify(built[0]) !== JSON.stringify(resolved.spec) ||
            (publication.publishable.length === 1) !== resolved.publishable ||
            (resolved.publishable && JSON.stringify(publication.publishable[0]?.spec) !== JSON.stringify(resolved.spec)))
            throw new Error(`configuration/publication mismatch: ${name}`);
        return { model: name, status: resolved.status, source: resolved.selected ? {
                provider: resolved.selected.providerID, record: resolved.selected.modelID,
            } : undefined, missing: resolved.reasons };
    });
    console.log(JSON.stringify({ total: results.length, configured: results.filter(({ status }) => status === "configured").length, models: results }, null, 2));
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
