import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../google-apps-script/Code.gs", import.meta.url), "utf8");
const context = vm.createContext({
  console,
  Utilities: {
    getUuid: () => "generated-id",
    formatDate: () => "2026-08-12"
  }
});
vm.runInContext(`${source}\nthis.__trackingTest = {
  determineAction_,
  escapeSheetText_,
  forceSheetText_,
  normalizeTrackedValue_,
  repairTaskIdsAfterDetachedSort_,
  reconcileSourceTaskIds_
};`, context);

const tracking = context.__trackingTest;

function sourceSheet(rows) {
  const values = rows.map((row) => ({ ...row }));
  const ranges = {
    3: values.map((row) => [row.content || ""]),
    10: values.map((row) => [row.orderDate || ""]),
    27: values.map((row) => [row.taskId || ""])
  };
  return {
    values,
    getLastRow: () => values.length + 1,
    getRange: (_row, column) => ({
      getDisplayValues: () => ranges[column].map((item) => [...item]),
      setValues: (next) => {
        ranges[column] = next.map((item) => [...item]);
        if (column === 27) next.forEach((item, index) => { values[index].taskId = item[0]; });
      }
    })
  };
}

test("Apps Script neutralizes values that Google Sheets could execute as formulas", () => {
  assert.equal(tracking.escapeSheetText_("=L2"), "'=L2");
  assert.equal(tracking.escapeSheetText_("+1+1"), "'+1+1");
  assert.equal(tracking.escapeSheetText_("normal text"), "normal text");
  assert.equal(tracking.forceSheetText_("2026-08-12"), "'2026-08-12");
});

test("Apps Script canonicalizes dates and treats re-entry after clear as an edit", () => {
  assert.equal(tracking.normalizeTrackedValue_("J", "12/8/2026"), "2026-08-12");
  assert.equal(tracking.normalizeTrackedValue_("C", "a\r\nb"), "a\nb");
  assert.equal(tracking.determineAction_("", "nhap lai", true), "EDIT");
});

test("Apps Script repairs a clear two-row A:Z sort that left hidden Task IDs behind", () => {
  const sheet = sourceSheet([
    { taskId: "task-a", content: "Beta", orderDate: "02/08/2026" },
    { taskId: "task-b", content: "Alpha", orderDate: "01/08/2026" }
  ]);
  const stateMap = {
    "task-a|C": { taskId: "task-a", column: "C", currentValue: "Alpha" },
    "task-a|J": { taskId: "task-a", column: "J", currentValue: "2026-08-01" },
    "task-b|C": { taskId: "task-b", column: "C", currentValue: "Beta" },
    "task-b|J": { taskId: "task-b", column: "J", currentValue: "2026-08-02" }
  };

  const result = tracking.repairTaskIdsAfterDetachedSort_(sheet, stateMap);
  assert.equal(result.relinkedIds, 2);
  assert.equal(result.repairedCycles, 1);
  assert.deepEqual([...result.unresolvedRows], []);
  assert.deepEqual(sheet.values.map((row) => row.taskId), ["task-b", "task-a"]);
});

test("Apps Script does not mistake a normal content edit for a detached sort", () => {
  const sheet = sourceSheet([
    { taskId: "task-a", content: "Alpha da sua", orderDate: "01/08/2026" },
    { taskId: "task-b", content: "Beta", orderDate: "02/08/2026" }
  ]);
  const stateMap = {
    "task-a|C": { taskId: "task-a", column: "C", currentValue: "Alpha" },
    "task-a|J": { taskId: "task-a", column: "J", currentValue: "2026-08-01" },
    "task-b|C": { taskId: "task-b", column: "C", currentValue: "Beta" },
    "task-b|J": { taskId: "task-b", column: "J", currentValue: "2026-08-02" }
  };

  const result = tracking.repairTaskIdsAfterDetachedSort_(sheet, stateMap);
  assert.equal(result.relinkedIds, 0);
  assert.equal(result.repairedCycles, 0);
  assert.deepEqual([...result.unresolvedRows], []);
  assert.deepEqual(sheet.values.map((row) => row.taskId), ["task-a", "task-b"]);
});

test("Apps Script fails closed when a detached sort is ambiguous", () => {
  const sheet = sourceSheet([
    { taskId: "task-a", content: "Beta", orderDate: "02/08/2026" },
    { taskId: "task-b", content: "Same", orderDate: "01/08/2026" },
    { taskId: "task-c", content: "Same", orderDate: "01/08/2026" }
  ]);
  const stateMap = {
    "task-a|C": { taskId: "task-a", column: "C", currentValue: "Same" },
    "task-a|J": { taskId: "task-a", column: "J", currentValue: "2026-08-01" },
    "task-b|C": { taskId: "task-b", column: "C", currentValue: "Beta" },
    "task-b|J": { taskId: "task-b", column: "J", currentValue: "2026-08-02" },
    "task-c|C": { taskId: "task-c", column: "C", currentValue: "Same" },
    "task-c|J": { taskId: "task-c", column: "J", currentValue: "2026-08-01" }
  };

  const result = tracking.repairTaskIdsAfterDetachedSort_(sheet, stateMap);
  assert.deepEqual([...result.unresolvedRows], [2, 3]);
  assert.deepEqual(sheet.values.map((row) => row.taskId), ["task-a", "task-b", "task-c"]);
});

test("Apps Script accepts two unrelated API edits as recovery changes", () => {
  const sheet = sourceSheet([
    { taskId: "task-a", content: "Alpha moi", orderDate: "01/08/2026" },
    { taskId: "task-b", content: "Beta moi", orderDate: "02/08/2026" }
  ]);
  const stateMap = {
    "task-a|C": { taskId: "task-a", column: "C", currentValue: "Alpha" },
    "task-a|J": { taskId: "task-a", column: "J", currentValue: "2026-08-01" },
    "task-b|C": { taskId: "task-b", column: "C", currentValue: "Beta" },
    "task-b|J": { taskId: "task-b", column: "J", currentValue: "2026-08-02" }
  };

  const result = tracking.repairTaskIdsAfterDetachedSort_(sheet, stateMap);
  assert.deepEqual([...result.unresolvedRows], []);
  assert.equal(result.relinkedIds, 0);
});

test("Apps Script repairs a detached sort between an active and blank task", () => {
  const sheet = sourceSheet([
    { taskId: "task-a", content: "", orderDate: "" },
    { taskId: "task-b", content: "Alpha", orderDate: "01/08/2026" }
  ]);
  const stateMap = {
    "task-a|C": { taskId: "task-a", column: "C", currentValue: "Alpha" },
    "task-a|J": { taskId: "task-a", column: "J", currentValue: "2026-08-01" },
    "task-b|C": { taskId: "task-b", column: "C", currentValue: "" },
    "task-b|J": { taskId: "task-b", column: "J", currentValue: "" }
  };

  const result = tracking.repairTaskIdsAfterDetachedSort_(sheet, stateMap);
  assert.equal(result.relinkedIds, 2);
  assert.deepEqual([...result.unresolvedRows], []);
  assert.deepEqual(sheet.values.map((row) => row.taskId), ["task-b", "task-a"]);
});

test("Apps Script retains a Task ID when both tracked cells are temporarily blank", () => {
  const sheet = sourceSheet([{ taskId: "task-a", content: "", orderDate: "" }]);
  context.ensureTaskIdColumn_ = () => {};
  context.readTaskIndexMap_ = () => ({});

  const result = tracking.reconcileSourceTaskIds_(sheet, {});
  assert.equal(result.releasedIds, 0);
  assert.equal(result.changedIds, 0);
  assert.equal(sheet.values[0].taskId, "task-a");
});
