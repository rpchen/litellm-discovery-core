import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve("openspec/changes")
if (!existsSync(root)) process.exit(0)

const completed = []
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "archive") continue
  const tasksPath = path.join(root, entry.name, "tasks.md")
  if (!existsSync(tasksPath)) continue
  const text = readFileSync(tasksPath, "utf8")
  const checked = [...text.matchAll(/^- \[x\]/gim)].length
  const unchecked = [...text.matchAll(/^- \[ \]/gm)].length
  if (checked > 0 && unchecked === 0) completed.push(entry.name)
}

if (completed.length > 0) {
  console.error("Completed OpenSpec changes must be archived before merge:")
  for (const name of completed) console.error(`- ${name}`)
  process.exit(1)
}
