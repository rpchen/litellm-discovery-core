# Tasks

## 1. Core shared logic

- [x] 1.1 Add and export pure incremental model-name, response-filter, publication-merge, catalog-miss, recovery-candidate and diagnostics-merge helpers.
- [x] 1.2 Add Core unit tests for delta identity, retained publication, degraded metadata recovery candidates, stable unmatched exclusion and diagnostics statistics.
- [x] 1.3 Update Core README public API notes and OpenSpec spec delta; archive remains part of post-merge cross-repository closure.

## 2. Adapter migration (after Core merge)

- [ ] 2.1 Replace duplicated Pi helpers with the Core API; preserve Pi cache/LKG/registration behavior and add temporary-failure recovery coverage.
- [ ] 2.2 Replace duplicated OpenCode helpers with the Core API; restore real-host outage/LKG/recovery scenarios and retain incremental discovery coverage.
- [ ] 2.3 Rebuild both adapters from the single merged Core SHA, update provenance/dist, and run their complete gates plus real host E2E.

## 3. Delivery

- [ ] 3.1 Create Core PR first; after explicit merge authorization and stable Core SHA, update Pi/OpenCode PRs without merging or releasing.
