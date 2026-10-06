# Design: persisted publication memory

## 职责边界

- Core 拥有语义：什么算「同一问题集合」、什么时候需要重新提醒、baseline 如何演进、记录的 schema/version 与安全解析。
- Adapter 只拥有存储位置与生命周期：Pi 复用 host-persisted catalog payload（每 endpoint 一份）；OpenCode 复用 `context.storage`，使用与 snapshot 同风格的独立 endpoint key。

## 记录形状

```ts
PublicationMemory {
  schemaVersion: 1
  acknowledgement?: { schemaVersion: 1, fingerprint, models: {model → fingerprint}, acknowledgedAt }
  published: string[]        // regression baseline
}
```

`published` 采用「只增 + 有界」演进（`nextPublishedBaseline`）：保留仍被 endpoint 提供的 withheld 模型的发布历史（因此跨轮次、跨重启的撤下仍然是 regression），忘记 LiteLLM 已不再返回的模型，避免无限增长。

## 失败模式

- 记录缺失/版本不符/结构损坏 → `undefined`：最多重复提醒一次。
- acknowledgement 存在但内部损坏 → 整份 acknowledgement 丢弃（绝不部分信任），`published` 仍可用于 regression。
- 持久化写入失败 → 只损失提醒抑制，不影响本轮的 publication 结果。
- 任何情况下 `parsePublicationMemory` 的结果都不进入 `buildPublicationResult`。

## 不可用 catalog 的提醒节奏

`unusable`（0 publishable）在首次观察或集合实质增长时提醒；同一 fingerprint 持续存在时静默（diagnostics 仍然逐模型可见），避免持续 0/N 时每次 poll 都打扰用户。
