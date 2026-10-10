import { expect, test } from "bun:test";
import { createDiscoveryCacheDiagnostics } from "../src/core/diagnostics.ts";
test("cache diagnostics distinguishes every adapter source and freshness rule", () => {
  const cases = [
    { source: "network" as const, stale: false },
    { source: "memory-cache" as const, stale: false },
    { source: "stale" as const, stale: true },
    { source: "snapshot" as const, stale: true },
    { source: "none" as const, stale: false },
  ];
  for (const item of cases) {
    expect(createDiscoveryCacheDiagnostics({
      source: item.source,
      refreshedAt: 1000,
      failureCount: 2,
      nextRetryAt: 5000,
      pending: item.source === "none",
    }, 4000)).toEqual({
      source: item.source,
      stale: item.stale,
      refreshedAt: 1000,
      ageMs: 3000,
      failureCount: 2,
      nextRetryAt: 5000,
      pending: item.source === "none",
    });
  }
});
