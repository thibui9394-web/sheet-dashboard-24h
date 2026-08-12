import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditTracking,
  editEventsFromPayload,
  flattenSnapshotHistory,
  inferSnapshotEditEvents,
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
    row: 10,
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
  assert.equal(event.eventRow, 10);
});

test("normalizeEditEvent keeps current row separate from row at edit time", () => {
  const event = normalizeEditEvent({
    eventId: "event-2",
    taskId: "task-10",
    row: 776,
    eventRow: 775,
    column: "C",
    action: "EDIT",
    revision: 2,
    oldValue: "Cu",
    newValue: "Moi",
    editedAt: "2026-08-12T03:00:00.000Z"
  });
  assert.equal(event.row, 776);
  assert.equal(event.eventRow, 775);
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

test("inferSnapshotEditEvents records a missed content edit", () => {
  const events = inferSnapshotEditEvents(
    [{ row: 10, taskId: "task-10", detail: "Test", orderDate: "2026-08-01" }],
    [{ row: 10, taskId: "task-10", detail: "Test 2", orderDate: "2026-08-01" }],
    [{
      eventId: "first-edit",
      taskId: "task-10",
      row: 10,
      column: "C",
      action: "EDIT",
      revision: 1,
      oldValue: "Original",
      newValue: "Test",
      editedAt: "2026-08-12T03:54:12.057Z"
    }],
    "2026-08-12T04:42:02.000Z"
  );

  assert.equal(events.length, 2);
  assert.deepEqual(events[1], {
    eventId: "snapshot:task-10:C:2026-08-12T04:42:02.000Z",
    batchId: "snapshot-diff",
    taskId: "task-10",
    row: 10,
    eventRow: 10,
    column: "C",
    field: "NỘI DUNG ORDER",
    action: "EDIT",
    revision: 2,
    oldValue: "Test",
    newValue: "Test 2",
    editedAt: "2026-08-12T04:42:02.000Z"
  });
});

test("inferSnapshotEditEvents does not duplicate an API event", () => {
  const event = {
    eventId: "api-edit",
    taskId: "task-10",
    row: 10,
    column: "C",
    action: "EDIT",
    revision: 2,
    oldValue: "Test\n",
    newValue: "Test 2\n",
    editedAt: "2026-08-12T04:42:02.000Z"
  };
  const events = inferSnapshotEditEvents(
    [{ row: 10, taskId: "task-10", detail: "Test", orderDate: "2026-08-01" }],
    [{ row: 10, taskId: "task-10", detail: "Test 2", orderDate: "2026-08-01" }],
    [event],
    "2026-08-12T04:45:00.000Z"
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventId, "api-edit");
});
