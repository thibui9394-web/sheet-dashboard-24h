import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditTracking,
  editEventsFromPayload,
  flattenSnapshotHistory,
  normalizeEditEvent
} from "./edit-tracking.mjs";

const records = [
  { row: 10, taskId: "task-10" },
  { row: 11, taskId: "task-11" }
];

test("normalizeEditEvent strips editor identity and keeps public fields", () => {
  const event = normalizeEditEvent({
    eventId: "e1",
    taskId: "task-10",
    column: "c",
    action: "edit",
    editedAt: "2026-08-12T10:00:00.000Z",
    editorEmail: "private@example.com",
    oldValue: "A",
    newValue: "B"
  });

  assert.equal(event.column, "C");
  assert.equal(event.field, "NỘI DUNG ORDER");
  assert.equal(event.editorEmail, undefined);
});

test("editEventsFromPayload accepts Apps Script response envelope", () => {
  const events = editEventsFromPayload({ events: [{
    taskId: "task-10",
    column: "J",
    action: "INITIAL",
    editedAt: "2026-08-12T10:00:00.000Z"
  }] });
  assert.equal(events.length, 1);
});

test("buildEditTracking excludes initial and baseline from edit count", () => {
  const result = buildEditTracking(records, [
    { taskId: "task-10", column: "C", action: "BASELINE", editedAt: "2026-08-10T10:00:00.000Z" },
    { taskId: "task-10", column: "J", action: "INITIAL", editedAt: "2026-08-11T10:00:00.000Z" },
    { taskId: "task-10", column: "C", action: "EDIT", editedAt: "2026-08-12T10:00:00.000Z" },
    { taskId: "task-10", column: "J", action: "CLEAR", editedAt: "2026-08-12T11:00:00.000Z" }
  ]);

  assert.deepEqual(result.summariesByTaskId.get("task-10"), {
    editCount: 2,
    contentEditCount: 1,
    dateEditCount: 1,
    hasDateChange: true,
    lastEditedAt: "2026-08-12T11:00:00.000Z"
  });
  assert.equal(result.history["task-10"][0].action, "CLEAR");
});

test("buildEditTracking ignores histories for tasks outside snapshot", () => {
  const result = buildEditTracking(records, [
    { taskId: "deleted-task", column: "C", action: "EDIT", editedAt: "2026-08-12T10:00:00.000Z" }
  ]);
  assert.deepEqual(result.history, {});
});

test("buildEditTracking does not publish baseline-only task history", () => {
  const result = buildEditTracking(records, [
    { taskId: "task-10", column: "C", action: "BASELINE", editedAt: "2026-08-12T10:00:00.000Z", newValue: "Existing" }
  ]);
  assert.deepEqual(result.history, {});
  assert.equal(result.summariesByTaskId.has("task-10"), false);
  assert.equal(result.stats.trackedTaskCount, 1);
});

test("flattenSnapshotHistory preserves history when API is not configured", () => {
  const events = [{ taskId: "task-10", column: "C", action: "EDIT", editedAt: "2026-08-12T10:00:00.000Z" }];
  assert.deepEqual(flattenSnapshotHistory({ editHistory: { "task-10": events } }), events);
});
