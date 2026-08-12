import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditTracking,
  editEventsFromPayload,
  flattenSnapshotHistory,
  inferSnapshotEditEvents,
  mergeEditEvents,
  normalizeEditEvent,
  normalizeTrackedValue
} from "./edit-tracking.mjs";

const records = [
  { row: 10, taskId: "task-10" },
  { row: 11, taskId: "task-11" }
];

function edit(overrides = {}) {
  return {
    eventId: "event-1",
    taskId: "task-10",
    row: 10,
    column: "C",
    action: "EDIT",
    revision: 1,
    oldValue: "A",
    newValue: "B",
    editedAt: "2026-08-12T10:00:00.000Z",
    ...overrides
  };
}

test("normalizeEditEvent strips every editor identity field", () => {
  const event = normalizeEditEvent({
    ...edit(),
    column: "c",
    editorEmail: "private@example.com",
    editor_email: "private-2@example.com",
    editedBy: "Admin Name",
    user: { email: "nested@example.com" }
  });

  assert.equal(event.column, "C");
  assert.equal(event.field, "NỘI DUNG ORDER");
  assert.equal(event.eventRow, 10);
  assert.equal(event.source, "edit-log");
  assert.equal(event.status, "confirmed");
  assert.equal(event.isRecovery, false);
  assert.equal(event.editorEmail, undefined);
  assert.equal(event.editor_email, undefined);
  assert.equal(event.editedBy, undefined);
  assert.equal(event.user, undefined);
  assert.doesNotMatch(JSON.stringify(event), /private@example|Admin Name|nested@example/);
});

test("normalizeEditEvent keeps current row separate from row at edit time", () => {
  const event = normalizeEditEvent(edit({
    eventId: "event-2",
    row: 776,
    eventRow: 775,
    revision: 2,
    oldValue: "Cũ",
    newValue: "Mới",
    editedAt: "2026-08-12T03:00:00.000Z"
  }));
  assert.equal(event.row, 776);
  assert.equal(event.eventRow, 775);
});

test("normalizeTrackedValue canonicalizes Vietnamese and ISO dates in column J", () => {
  assert.equal(normalizeTrackedValue("J", "3/8/2026"), "2026-08-03");
  assert.equal(normalizeTrackedValue("j", "03.08.2026 00:00:00"), "2026-08-03");
  assert.equal(normalizeTrackedValue("J", "2026/8/3"), "2026-08-03");
  assert.equal(normalizeTrackedValue("J", "31/02/2026"), "31/02/2026");
});

test("normalizeEditEvent canonicalizes old and new date values", () => {
  const event = normalizeEditEvent(edit({
    column: "J",
    oldValue: "3/8/2026",
    newValue: "12/08/2026 00:00:00"
  }));
  assert.equal(event.field, "NGÀY ORDER");
  assert.equal(event.oldValue, "2026-08-03");
  assert.equal(event.newValue, "2026-08-12");
});

test("editEventsFromPayload accepts Apps Script response envelope and sanitizes it", () => {
  const events = editEventsFromPayload({ events: [{
    taskId: "task-10",
    column: "J",
    action: "INITIAL",
    newValue: "12/08/2026",
    editedAt: "2026-08-12T10:00:00.000Z",
    editorEmail: "secret@example.com"
  }] });
  assert.equal(events.length, 1);
  assert.equal(events[0].newValue, "2026-08-12");
  assert.equal(events[0].editorEmail, undefined);
});

test("mergeEditEvents keeps old history when API payload is partial", () => {
  const previous = [
    edit({ eventId: "e1", revision: 1, oldValue: "A", newValue: "B", editedAt: "2026-08-12T01:00:00.000Z" }),
    edit({ eventId: "e2", revision: 2, oldValue: "B", newValue: "C", editedAt: "2026-08-12T02:00:00.000Z" })
  ];
  const partialApi = [
    edit({ eventId: "e3", revision: 3, oldValue: "C", newValue: "D", editedAt: "2026-08-12T03:00:00.000Z" })
  ];
  const merged = mergeEditEvents(previous, partialApi);

  assert.deepEqual(merged.map((event) => event.eventId), ["e1", "e2", "e3"]);
});

test("mergeEditEvents deduplicates the same eventId without dropping other history", () => {
  const merged = mergeEditEvents(
    [edit({ eventId: "same", row: 10 }), edit({ eventId: "old", revision: 0 })],
    [edit({ eventId: "same", row: 99 })]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((event) => event.eventId === "same").row, 99);
  assert.ok(merged.some((event) => event.eventId === "old"));
});

test("mergeEditEvents preserves repeated A to B and revert transitions with distinct IDs", () => {
  const merged = mergeEditEvents([
    edit({ eventId: "e1", revision: 1, oldValue: "A", newValue: "B", editedAt: "2026-08-12T01:00:00.000Z" }),
    edit({ eventId: "e2", revision: 2, oldValue: "B", newValue: "A", editedAt: "2026-08-12T02:00:00.000Z" })
  ], [
    edit({ eventId: "e3", revision: 3, oldValue: "A", newValue: "B", editedAt: "2026-08-12T03:00:00.000Z" })
  ]);

  assert.deepEqual(merged.map((event) => event.eventId), ["e1", "e2", "e3"]);
  assert.deepEqual(merged.map((event) => event.revision), [1, 2, 3]);
});

test("mergeEditEvents replaces a matching recovery placeholder with confirmed event", () => {
  const recovery = edit({
    eventId: "recovery:task-10:C:t",
    batchId: "snapshot-recovery",
    revision: 2,
    oldValue: "B",
    newValue: "C",
    source: "snapshot-recovery",
    trackingStatus: "recovery",
    isRecovery: true
  });
  const confirmed = edit({
    eventId: "official-2",
    revision: 2,
    oldValue: "B",
    newValue: "C"
  });
  const merged = mergeEditEvents([recovery], [confirmed]);

  assert.deepEqual(merged.map((event) => event.eventId), ["official-2"]);
  assert.equal(merged[0].status, "confirmed");
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
    recoveryCount: 0,
    hasDateChange: true,
    lastEditedAt: "2026-08-12T11:00:00.000Z"
  });
  assert.equal(result.history["task-10"][0].action, "CLEAR");
});

test("buildEditTracking does not double count a duplicated eventId", () => {
  const event = edit({ eventId: "same-edit" });
  const result = buildEditTracking(records, [event, { ...event, editorEmail: "secret@example.com" }]);
  assert.equal(result.stats.totalEditCount, 1);
  assert.equal(result.history["task-10"].length, 1);
  assert.equal(result.history["task-10"][0].editorEmail, undefined);
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

test("flattenSnapshotHistory sanitizes and preserves previous history", () => {
  const events = [edit({ editorEmail: "secret@example.com" })];
  const flattened = flattenSnapshotHistory({ editHistory: { "task-10": events } });
  assert.equal(flattened.length, 1);
  assert.equal(flattened[0].eventId, "event-1");
  assert.equal(flattened[0].editorEmail, undefined);
});

test("inferSnapshotEditEvents creates an explicit recovery event for a missed edit", () => {
  const events = inferSnapshotEditEvents(
    [{ row: 10, taskId: "task-10", detail: "Test", orderDate: "2026-08-01" }],
    [{ row: 10, taskId: "task-10", detail: "Test 2", orderDate: "2026-08-01" }],
    [edit({
      eventId: "first-edit",
      revision: 1,
      oldValue: "Original",
      newValue: "Test",
      editedAt: "2026-08-12T03:54:12.057Z"
    })],
    "2026-08-12T04:42:02.000Z"
  );

  assert.equal(events.length, 2);
  assert.deepEqual(events[1], {
    eventId: "recovery:task-10:C:2026-08-12T04:42:02.000Z",
    batchId: "snapshot-recovery",
    taskId: "task-10",
    row: 10,
    eventRow: 10,
    column: "C",
    field: "NỘI DUNG ORDER",
    action: "EDIT",
    revision: 2,
    oldValue: "Test",
    newValue: "Test 2",
    editedAt: "2026-08-12T04:42:02.000Z",
    source: "snapshot-recovery",
    status: "recovery",
    isRecovery: true
  });
});

test("buildEditTracking publishes recovery history without counting it as confirmed edit", () => {
  const recovery = inferSnapshotEditEvents(
    [{ row: 10, taskId: "task-10", detail: "A", orderDate: "2026-08-01" }],
    [{ row: 10, taskId: "task-10", detail: "B", orderDate: "2026-08-01" }],
    [],
    "2026-08-12T04:42:02.000Z"
  );
  const result = buildEditTracking(records, recovery);

  assert.deepEqual(result.summariesByTaskId.get("task-10"), {
    editCount: 0,
    contentEditCount: 0,
    dateEditCount: 0,
    recoveryCount: 1,
    hasDateChange: false,
    lastEditedAt: "2026-08-12T04:42:02.000Z"
  });
  assert.equal(result.history["task-10"].length, 1);
  assert.equal(result.history["task-10"][0].status, "recovery");
  assert.deepEqual(result.stats, {
    trackedTaskCount: 1,
    editedTaskCount: 0,
    totalEditCount: 0,
    recoveryTaskCount: 1,
    recoveryEventCount: 1
  });
});

test("inferSnapshotEditEvents does not duplicate a formatted date API event", () => {
  const event = edit({
    eventId: "api-date-edit",
    column: "J",
    revision: 2,
    oldValue: "3/8/2026",
    newValue: "4/8/2026"
  });
  const events = inferSnapshotEditEvents(
    [{ row: 10, taskId: "task-10", detail: "Task", orderDate: "2026-08-03" }],
    [{ row: 10, taskId: "task-10", detail: "Task", orderDate: "2026-08-04" }],
    [event],
    "2026-08-12T04:45:00.000Z"
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventId, "api-date-edit");
  assert.equal(events[0].newValue, "2026-08-04");
});

test("inferSnapshotEditEvents accepts a confirmed chain covering the snapshot change", () => {
  const events = inferSnapshotEditEvents(
    [{ row: 10, taskId: "task-10", detail: "A", orderDate: "2026-08-01" }],
    [{ row: 10, taskId: "task-10", detail: "C", orderDate: "2026-08-01" }],
    [
      edit({ eventId: "e1", revision: 1, oldValue: "A", newValue: "B", editedAt: "2026-08-12T01:00:00.000Z" }),
      edit({ eventId: "e2", revision: 2, oldValue: "B", newValue: "C", editedAt: "2026-08-12T02:00:00.000Z" })
    ],
    "2026-08-12T03:00:00.000Z"
  );

  assert.deepEqual(events.map((event) => event.eventId), ["e1", "e2"]);
  assert.ok(events.every((event) => event.status === "confirmed"));
});

test("inferSnapshotEditEvents does not let an older confirmed transition hide a new missed edit", () => {
  const events = [
    edit({ eventId: "official-a-b", oldValue: "A", newValue: "B", revision: 1 }),
    edit({
      eventId: "recovery-b-a",
      oldValue: "B",
      newValue: "A",
      revision: 2,
      source: "snapshot-recovery",
      trackingStatus: "recovery",
      isRecovery: true
    })
  ];
  const inferred = inferSnapshotEditEvents(
    [{ taskId: "task-10", row: 10, detail: "A", orderDate: "2026-08-01" }],
    [{ taskId: "task-10", row: 10, detail: "B", orderDate: "2026-08-01" }],
    events,
    "2026-08-12T12:00:00.000Z"
  );
  const recoveries = inferred.filter((item) => item.isRecovery && item.oldValue === "A" && item.newValue === "B");
  assert.equal(recoveries.length, 1);
});

test("inferSnapshotEditEvents does not mistake an older repeated A to B for the current edit", () => {
  const events = inferSnapshotEditEvents(
    [{ row: 10, taskId: "task-10", detail: "A", orderDate: "2026-08-01" }],
    [{ row: 10, taskId: "task-10", detail: "B", orderDate: "2026-08-01" }],
    [
      edit({ eventId: "e1", revision: 1, oldValue: "A", newValue: "B", editedAt: "2026-08-12T01:00:00.000Z" }),
      edit({ eventId: "e2", revision: 2, oldValue: "B", newValue: "A", editedAt: "2026-08-12T02:00:00.000Z" })
    ],
    "2026-08-12T03:00:00.000Z"
  );

  assert.equal(events.length, 3);
  assert.equal(events.at(-1).revision, 3);
  assert.equal(events.at(-1).status, "recovery");
  assert.equal(events.at(-1).oldValue, "A");
  assert.equal(events.at(-1).newValue, "B");
});

test("inferSnapshotEditEvents counts re-entry after clear as edit, not initial", () => {
  const events = inferSnapshotEditEvents(
    [{ row: 10, taskId: "task-10", detail: "", orderDate: "2026-08-01" }],
    [{ row: 10, taskId: "task-10", detail: "A", orderDate: "2026-08-01" }],
    [
      edit({ eventId: "initial", action: "INITIAL", revision: 0, oldValue: "", newValue: "A", editedAt: "2026-08-12T01:00:00.000Z" }),
      edit({ eventId: "clear", action: "CLEAR", revision: 1, oldValue: "A", newValue: "", editedAt: "2026-08-12T02:00:00.000Z" })
    ],
    "2026-08-12T03:00:00.000Z"
  );

  const recovery = events.at(-1);
  assert.equal(recovery.action, "EDIT");
  assert.equal(recovery.revision, 2);
  assert.equal(recovery.oldValue, "");
  assert.equal(recovery.newValue, "A");
});
