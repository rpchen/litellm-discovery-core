import { describe, expect, test } from "bun:test"
import {
  createDiscoveryCoordinator,
  DEFAULT_DISCOVERY_BACKOFF_MS,
  DEFAULT_DISCOVERY_TTL_MS,
} from "../src/core/refresh.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("createDiscoveryCoordinator", () => {
  test("并发刷新按 key singleflight，共享同一个网络请求", async () => {
    const gate = deferred<string>()
    const coordinator = createDiscoveryCoordinator<string>()
    let calls = 0
    const discover = async () => {
      calls += 1
      return gate.promise
    }

    const first = coordinator.refresh("deployment-a", discover)
    const second = coordinator.refresh("deployment-a", discover)
    expect(calls).toBe(0)

    await Promise.resolve()
    expect(calls).toBe(1)
    gate.resolve("fresh")

    expect((await first).value).toBe("fresh")
    expect((await second).value).toBe("fresh")
    expect(calls).toBe(1)
  })

  test("短 TTL 内直接返回 cache，过期后重新发现", async () => {
    let now = 1_000
    let calls = 0
    const coordinator = createDiscoveryCoordinator<number>({ ttlMs: 30_000, now: () => now })
    const discover = async () => ++calls

    const first = await coordinator.refresh("deployment-a", discover)
    expect(first.source).toBe("network")
    expect(first.value).toBe(1)

    now += 29_999
    const cached = await coordinator.refresh("deployment-a", discover)
    expect(cached.source).toBe("cache")
    expect(cached.value).toBe(1)
    expect(calls).toBe(1)

    now += 1
    const refreshed = await coordinator.refresh("deployment-a", discover)
    expect(refreshed.source).toBe("network")
    expect(refreshed.value).toBe(2)
    expect(calls).toBe(2)
  })

  test("forceRefresh 绕过 TTL 与退避窗口", async () => {
    let now = 10_000
    let calls = 0
    const coordinator = createDiscoveryCoordinator<string>({
      ttlMs: DEFAULT_DISCOVERY_TTL_MS,
      now: () => now,
    })

    await coordinator.refresh("deployment-a", async () => {
      calls += 1
      return "v1"
    })
    const forced = await coordinator.refresh(
      "deployment-a",
      async () => {
        calls += 1
        return "v2"
      },
      { forceRefresh: true },
    )

    expect(forced.source).toBe("network")
    expect(forced.value).toBe("v2")
    expect(calls).toBe(2)

    now += DEFAULT_DISCOVERY_TTL_MS
    await coordinator.refresh("deployment-a", async () => {
      calls += 1
      throw new Error("temporary")
    })
    expect(coordinator.retryDelayMs("deployment-a")).toBe(DEFAULT_DISCOVERY_BACKOFF_MS[0])

    const forcedAfterFailure = await coordinator.refresh(
      "deployment-a",
      async () => {
        calls += 1
        return "v3"
      },
      { forceRefresh: true },
    )
    expect(forcedAfterFailure.value).toBe("v3")
    expect(calls).toBe(4)
  })

  test("失败使用 1/2/5/10/30 秒退避并返回 last-known-good stale", async () => {
    let now = 100_000
    const coordinator = createDiscoveryCoordinator<string>({ ttlMs: 1, now: () => now })

    await coordinator.refresh("deployment-a", async () => "good")
    now += 1

    for (const [index, delay] of DEFAULT_DISCOVERY_BACKOFF_MS.entries()) {
      const stale = await coordinator.refresh("deployment-a", async () => {
        throw new Error(`failure-${index + 1}`)
      }, { forceRefresh: true })

      expect(stale.source).toBe("stale")
      expect(stale.stale).toBeTrue()
      expect(stale.value).toBe("good")
      expect(stale.failureCount).toBe(index + 1)
      expect(coordinator.retryDelayMs("deployment-a")).toBe(delay)

      const suppressed = await coordinator.refresh("deployment-a", async () => {
        throw new Error("must not run")
      })
      expect(suppressed.source).toBe("stale")
      expect(suppressed.failureCount).toBe(index + 1)
      now += delay
    }

    const capped = await coordinator.refresh("deployment-a", async () => {
      throw new Error("failure-capped")
    }, { forceRefresh: true })
    expect(capped.failureCount).toBe(DEFAULT_DISCOVERY_BACKOFF_MS.length + 1)
    expect(coordinator.retryDelayMs("deployment-a")).toBe(DEFAULT_DISCOVERY_BACKOFF_MS.at(-1))
  })

  test("无 last-known-good 时失败会拒绝，并在退避期抑制重复调用", async () => {
    let now = 0
    let calls = 0
    const coordinator = createDiscoveryCoordinator<string>({ now: () => now })
    const failure = new Error("offline")
    const discover = async () => {
      calls += 1
      throw failure
    }

    await expect(coordinator.refresh("deployment-a", discover)).rejects.toBe(failure)
    expect(calls).toBe(1)
    expect(coordinator.retryDelayMs("deployment-a")).toBe(1_000)

    await expect(coordinator.refresh("deployment-a", discover)).rejects.toBe(failure)
    expect(calls).toBe(1)

    now += 1_000
    await expect(coordinator.refresh("deployment-a", discover)).rejects.toBe(failure)
    expect(calls).toBe(2)
    expect(coordinator.retryDelayMs("deployment-a")).toBe(2_000)
  })

  test("clear failure policy 清除旧值且不进入 stale/backoff", async () => {
    let now = 0
    const coordinator = createDiscoveryCoordinator<string>({ ttlMs: 1, now: () => now })
    await coordinator.refresh("deployment-a", async () => "good")
    now += 1

    const authError = new Error("auth")
    await expect(
      coordinator.refresh(
        "deployment-a",
        async () => {
          throw authError
        },
        { forceRefresh: true, failurePolicy: () => "clear" },
      ),
    ).rejects.toBe(authError)

    expect(coordinator.state("deployment-a")).toMatchObject({
      hasValue: false,
      failureCount: 0,
      pending: false,
      nextRetryAt: undefined,
      lastError: authError,
    })
  })

  test("不同 key 的缓存、pending 与退避彼此隔离", async () => {
    const coordinator = createDiscoveryCoordinator<string>()
    const [a, b] = await Promise.all([
      coordinator.refresh("deployment-a", async () => "a"),
      coordinator.refresh("deployment-b", async () => "b"),
    ])
    expect(a.value).toBe("a")
    expect(b.value).toBe("b")
    expect(coordinator.state("deployment-a").value).toBe("a")
    expect(coordinator.state("deployment-b").value).toBe("b")

    coordinator.clear("deployment-a")
    expect(coordinator.state("deployment-a").hasValue).toBeFalse()
    expect(coordinator.state("deployment-b").hasValue).toBeTrue()

    coordinator.clearAll()
    expect(coordinator.state("deployment-b").hasValue).toBeFalse()
  })
})
