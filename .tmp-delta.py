import io

src = io.open("openspec/specs/discovery-resilience/spec.md", encoding="utf-8").read()
start = src.index("### Requirement: Notification acknowledgement")
end = src.index("### Requirement:", start + 1)
block = src[start:end].rstrip()

new = block.replace(
    "Core SHALL expose an acknowledgement state that can suppress a repeated notification about an unchanged problem set.",
    "Core SHALL expose a versioned publication memory that can suppress a repeated notification about an unchanged problem set. The memory SHALL survive host restarts: an adapter persists the Core-produced record and restores it before the next discovery round, so the same fingerprint observed in a later process is reported as `unchanged` rather than as a first observation. The record SHALL also carry the regression baseline (the model ids the applied catalog published) so that a withdrawal is still a regression after a restart. A record that is missing, corrupt, or written by an incompatible schema version SHALL be ignored without throwing and SHALL NOT be partially trusted: the worst consequence is one repeated notification. The acknowledgement SHALL NOT be stored inside any publication verdict.",
)
assert new != block, "statement replacement failed"

new += """

#### Scenario: Suppression survives a host restart
- **WHEN** a problem set was surfaced and persisted, and the host restarts with the same fingerprint
- **THEN** Core reports `unchanged`, produces no notification, and keeps every withheld model withheld

#### Scenario: A non-interruptive first observation stores nothing
- **WHEN** the only withheld models are newly discovered and no regression occurred
- **THEN** Core reports `first-observation`, produces no notification, and records no acknowledgement to suppress

#### Scenario: Material growth after a restart re-notifies
- **WHEN** a restored acknowledgement exists and the withheld set grows or a model's reason materially changes
- **THEN** Core reports the problem again (`catalog-unusable` or `new-issues`) instead of suppressing it

#### Scenario: Regression after a restart re-notifies
- **WHEN** the restored baseline says a model was previously published and it is withheld now
- **THEN** Core reports a regression notification regardless of the stored acknowledgement

#### Scenario: An unusable catalog notifies once, not every round
- **WHEN** discovered models exist, none are publishable, and the problem set is identical to the acknowledged one
- **THEN** Core stays quiet (diagnostics still lists the withheld models); a materially larger problem set is reported again

#### Scenario: Unreadable memory is inert
- **WHEN** the persisted record is missing, corrupt, or written by an older schema version
- **THEN** Core ignores it, still computes the same publication partition, and at most repeats a notification
"""

io.open(
    "openspec/changes/add-persisted-publication-memory/specs/discovery-resilience/spec.md",
    "w",
    encoding="utf-8",
    newline="\n",
).write("## MODIFIED Requirements\n\n" + new + "\n")
print("core delta rewritten")
