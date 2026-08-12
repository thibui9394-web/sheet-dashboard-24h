import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/update-snapshot.yml", import.meta.url);

test("workflow mặc định full scan và có concurrency chống race", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /scan_all:[\s\S]*?default:\s*true/);
  assert.match(workflow, /concurrency:[\s\S]*?group:\s*update-dashboard-snapshot-/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /\|\| \[ \$\{#MONTHS\[@\]\} -eq 0 \]/);
  assert.match(workflow, /FORCE_FULL_SNAPSHOT=true node \.\/scripts\/update-snapshot\.mjs/);
});
