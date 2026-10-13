# Tasks

## 1. Core shared logic

- [x] 1.1 Add and export pure incremental model-name, response-filter, publication-merge, catalog-miss, recovery-candidate and diagnostics-merge helpers.
- [x] 1.2 Add Core unit tests for delta identity, retained publication, degraded metadata recovery candidates, stable unmatched exclusion and diagnostics statistics.
- [x] 1.3 Update Core README public API notes and OpenSpec spec delta; archive remains part of post-merge cross-repository closure.

### Scenario evidence mapping

| OpenSpec Scenario | Automated evidence |
|---|---|
| Isolated consumer import / adapter reuses shared incremental semantics | `npm run test:package` → packed external `consumer.mjs` imports and calls `modelNameDelta`, `modelNamesOfResponse`, `responseForModelNames`, `mergePublicationResults`, `needsCatalogRefresh`, `mergeDiscoveryDiagnostics`, and `temporaryMetadataFailureModelNames`; `consumer.ts` typechecks `ModelNameDelta` |
| Host-free incremental merge | `test/incremental.test.ts` → `merges only processed publication identities` |
| Temporary catalog failure can recover / stable unmatched identity is not retried | `test/incremental.test.ts` → `only degraded metadata-withheld models are recovery candidates` |
| Publication merge preserves the existing gate | `test/incremental.test.ts` → `merges only processed publication identities` |
| Retained diagnostics / aggregate statistics after additions and deletions | `test/incremental.test.ts` → `merges diagnostics for additions and deletions using current response statistics` |

## 2. Adapter migration (after Core merge)

- [ ] 2.1 Replace duplicated Pi helpers with the Core API; preserve Pi cache/LKG/registration behavior and add temporary-failure recovery coverage.
- [ ] 2.2 Replace duplicated OpenCode helpers with the Core API; restore real-host outage/LKG/recovery scenarios and retain incremental discovery coverage.
- [ ] 2.3 Rebuild both adapters from the single merged Core SHA, update provenance/dist, and run their complete gates plus real host E2E.

## 3. Delivery

- [ ] 3.1 Create Core PR first; after explicit merge authorization and stable Core SHA, update Pi/OpenCode PRs without merging or releasing.
