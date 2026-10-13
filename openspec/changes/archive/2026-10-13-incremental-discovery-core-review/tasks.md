# Tasks

## 1. Core shared logic

- [x] 1.1 Add and export pure incremental model-name, response-filter, publication-merge, catalog-miss, recovery-candidate and diagnostics-merge helpers.
- [x] 1.2 Add Core unit tests for delta identity, retained publication, degraded metadata recovery candidates, stable unmatched exclusion and diagnostics statistics.
- [x] 1.3 Update Core README public API notes and OpenSpec spec delta; archive and canonical synchronization were completed in Core documentation PR #38.

### Scenario evidence mapping

| OpenSpec Scenario | Automated evidence |
|---|---|
| Isolated consumer import / adapter reuses shared incremental semantics | `npm run test:package` → packed external `consumer.mjs` imports and calls `modelNameDelta`, `modelNamesOfResponse`, `responseForModelNames`, `mergePublicationResults`, `needsCatalogRefresh`, `mergeDiscoveryDiagnostics`, and `temporaryMetadataFailureModelNames`; `consumer.ts` typechecks `ModelNameDelta` |
| Host-free incremental merge | `test/incremental.test.ts` → `merges only processed publication identities` |
| Temporary catalog failure can recover / stable unmatched identity is not retried | `test/incremental.test.ts` → `only degraded metadata-withheld models are recovery candidates` |
| Publication merge preserves the existing gate | `test/incremental.test.ts` → `merges only processed publication identities` |
| Retained diagnostics / aggregate statistics after additions and deletions | `test/incremental.test.ts` → `merges diagnostics for additions and deletions using current response statistics` |

## 2. Adapter migration (after Core merge)

- [x] 2.1 Replace duplicated Pi helpers with the Core API; preserve Pi cache/LKG/registration behavior and add temporary-failure recovery coverage. Pi PR #59 final HEAD `f3c68f829598b9111338dfac979cee802bbeb980`; CI and Real Pi E2E run `38342181258` passed.
- [x] 2.2 Replace duplicated OpenCode helpers with the Core API; restore real-host outage/LKG/recovery scenarios and retain incremental discovery coverage. OpenCode PR #67 final HEAD `876221953643223e8ecee4a65539ac94a57b8aac`; CI and Real OpenCode E2E run `38342294540` passed.
- [x] 2.3 Rebuild both adapters from the single merged Core SHA `a08db4a70498ae7f397c264bb3f7c01eb196e1f8`, update provenance/dist, and run their complete gates plus real host E2E. Both adapters' `dist/core-provenance.json` match that SHA.

## 3. Delivery

- [x] 3.1 Create Core PR #37 first, merge only after explicit authorization, then update Pi/OpenCode PRs from its stable SHA. Core #37 merged as `a08db4a70498ae7f397c264bb3f7c01eb196e1f8`; adapter PRs #59/#67 remain open pending separate merge authorization. No tag or Release was created.
