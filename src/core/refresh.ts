export const DEFAULT_DISCOVERY_TTL_MS = 30_000
export const DEFAULT_DISCOVERY_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

export type RefreshSource = "network" | "cache" | "stale"
export type RefreshFailurePolicy = "stale" | "clear" | "ignore"

export interface RefreshResult<T> {
  readonly value: T
  readonly source: RefreshSource
  readonly stale: boolean
  readonly refreshedAt: number
  readonly failureCount: number
  readonly nextRetryAt?: number
  readonly error?: unknown
}

export interface RefreshState<T> {
  readonly hasValue: boolean
  readonly value?: T
  readonly refreshedAt?: number
  readonly expiresAt?: number
  readonly failureCount: number
  readonly nextRetryAt?: number
  readonly pending: boolean
  readonly lastError?: unknown
}

export interface DiscoveryCoordinatorOptions {
  readonly ttlMs?: number
  readonly backoffMs?: readonly number[]
  readonly now?: () => number
  readonly failurePolicy?: (error: unknown) => RefreshFailurePolicy
}

export interface RefreshRequestOptions {
  readonly forceRefresh?: boolean
  readonly failurePolicy?: (error: unknown) => RefreshFailurePolicy
}

export interface DiscoveryCoordinator<T> {
  refresh(
    key: string,
    discover: () => Promise<T>,
    options?: RefreshRequestOptions,
  ): Promise<RefreshResult<T>>
  state(key: string): RefreshState<T>
  retryDelayMs(key: string): number | undefined
  clear(key: string): void
  clearAll(): void
}

interface Entry<T> {
  hasValue: boolean
  value?: T
  refreshedAt?: number
  expiresAt: number
  failureCount: number
  retryAt: number
  lastError?: unknown
  pending?: Promise<RefreshResult<T>>
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`)
  return value
}

function normalizeBackoff(values: readonly number[]): readonly number[] {
  if (values.length === 0) throw new Error("backoffMs must contain at least one delay")
  return values.map((value, index) => positiveFinite(value, `backoffMs[${index}]`))
}

function emptyEntry<T>(): Entry<T> {
  return { hasValue: false, expiresAt: 0, failureCount: 0, retryAt: 0 }
}

export function createDiscoveryCoordinator<T>(
  options: DiscoveryCoordinatorOptions = {},
): DiscoveryCoordinator<T> {
  const ttlMs = positiveFinite(options.ttlMs ?? DEFAULT_DISCOVERY_TTL_MS, "ttlMs")
  const backoffMs = normalizeBackoff(options.backoffMs ?? DEFAULT_DISCOVERY_BACKOFF_MS)
  const now = options.now ?? Date.now
  const defaultFailurePolicy = options.failurePolicy ?? (() => "stale" as const)
  const entries = new Map<string, Entry<T>>()

  const entryFor = (key: string): Entry<T> => {
    const existing = entries.get(key)
    if (existing) return existing
    const created = emptyEntry<T>()
    entries.set(key, created)
    return created
  }

  const resultFromEntry = (
    entry: Entry<T>,
    source: "cache" | "stale",
  ): RefreshResult<T> => {
    if (!entry.hasValue) throw new Error("refresh coordinator entry has no cached value")
    return {
      value: entry.value as T,
      source,
      stale: source === "stale",
      refreshedAt: entry.refreshedAt ?? 0,
      failureCount: entry.failureCount,
      nextRetryAt: entry.retryAt > 0 ? entry.retryAt : undefined,
      error: source === "stale" ? entry.lastError : undefined,
    }
  }

  const refresh = (
    key: string,
    discover: () => Promise<T>,
    request: RefreshRequestOptions = {},
  ): Promise<RefreshResult<T>> => {
    const entry = entryFor(key)
    if (entry.pending) return entry.pending

    const startedAt = now()
    if (!request.forceRefresh) {
      if (entry.hasValue && startedAt < entry.expiresAt) {
        return Promise.resolve(resultFromEntry(entry, "cache"))
      }
      if (entry.retryAt > startedAt) {
        if (entry.hasValue) return Promise.resolve(resultFromEntry(entry, "stale"))
        return Promise.reject(entry.lastError ?? new Error("discovery retry is in backoff"))
      }
    }

    let pending!: Promise<RefreshResult<T>>
    pending = Promise.resolve()
      .then(discover)
      .then((value): RefreshResult<T> => {
        const completedAt = now()
        entry.hasValue = true
        entry.value = value
        entry.refreshedAt = completedAt
        entry.expiresAt = completedAt + ttlMs
        entry.failureCount = 0
        entry.retryAt = 0
        entry.lastError = undefined
        return {
          value,
          source: "network",
          stale: false,
          refreshedAt: completedAt,
          failureCount: 0,
        }
      })
      .catch((error: unknown): RefreshResult<T> => {
        const policy = request.failurePolicy?.(error) ?? defaultFailurePolicy(error)
        if (policy === "ignore") throw error

        if (policy === "clear") {
          entry.hasValue = false
          entry.value = undefined
          entry.refreshedAt = undefined
          entry.expiresAt = 0
          entry.failureCount = 0
          entry.retryAt = 0
          entry.lastError = error
          throw error
        }

        const failedAt = now()
        entry.failureCount += 1
        const delay = backoffMs[Math.min(entry.failureCount - 1, backoffMs.length - 1)]!
        entry.retryAt = failedAt + delay
        entry.lastError = error
        if (entry.hasValue) return resultFromEntry(entry, "stale")
        throw error
      })
      .finally(() => {
        if (entry.pending === pending) entry.pending = undefined
      })

    entry.pending = pending
    return pending
  }

  return {
    refresh,
    state(key) {
      const entry = entries.get(key)
      if (!entry) return { hasValue: false, failureCount: 0, pending: false }
      return {
        hasValue: entry.hasValue,
        value: entry.hasValue ? entry.value : undefined,
        refreshedAt: entry.refreshedAt,
        expiresAt: entry.hasValue ? entry.expiresAt : undefined,
        failureCount: entry.failureCount,
        nextRetryAt: entry.retryAt > 0 ? entry.retryAt : undefined,
        pending: entry.pending !== undefined,
        lastError: entry.lastError,
      }
    },
    retryDelayMs(key) {
      const entry = entries.get(key)
      if (!entry || entry.retryAt === 0) return undefined
      return Math.max(0, entry.retryAt - now())
    },
    clear(key) {
      entries.delete(key)
    },
    clearAll() {
      entries.clear()
    },
  }
}
