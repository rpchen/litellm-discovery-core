# Session retrospective hardening

## Why

The PR8 follow-up session exposed repeatable process and discovery-quality failure modes: capability fallback was conflated with provider pricing, neutral zero limits could leak into host configuration, completed OpenSpec changes could remain active, and release documentation could drift from the actual tag. These must be enforced by repository rules and CI rather than conversation memory.

## What Changes

- Track models.dev selection provenance and separate capability enrichment from route pricing.
- Define positive operational token limits as a host-publication invariant.
- Add diagnostics and regression coverage for unsafe pricing and missing limits.
- Extend the shared testing standard with discovery, UI/time, OpenSpec and release closure rules.
- Add CI detection for completed but unarchived OpenSpec changes.
