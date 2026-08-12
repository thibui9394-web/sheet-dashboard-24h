const TRACKED_COLUMNS = new Set(["C", "J"]);
const COUNTED_ACTIONS = new Set(["EDIT", "CLEAR"]);

const CONFIRMED_SOURCE = "edit-log";
const CONFIRMED_STATUS = "confirmed";
const RECOVERY_SOURCE = "snapshot-recovery";
const RECOVERY_STATUS = "recovery";

function cleanText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function cleanInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validDateParts(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}

function canonicalDate(value) {
  const text = cleanText(value).trim();
  if (!text) return "";

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (validDateParts(year, month, day)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Google Sheet is configured for Vietnamese dates, so slash/dot/dash values
  // with the year last are interpreted as day-month-year.
  const local = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+.*)?$/);
  if (local) {
    const day = Number(local[1]);
    const month = Number(local[2]);
    const year = Number(local[3]);
    if (validDateParts(year, month, day)) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Preserve unexpected values. They are still useful evidence in edit history.
  return text;
}

export function normalizeTrackedValue(column, value) {
  const normalizedColumn = cleanText(column).trim().toUpperCase();
  if (normalizedColumn === "J") return canonicalDate(value);
  return cleanText(value).replace(/\r\n?/g, "\n");
}

function comparableValue(column, value) {
  return normalizeTrackedValue(column, value).trim();
}

function provenanceFor(raw) {
  const suppliedSource = cleanText(
    raw.source || raw.eventSource || raw.event_source || raw.trackingSource || raw.tracking_source
  ).trim().toLowerCase();
  const suppliedStatus = cleanText(
    raw.trackingStatus || raw.tracking_status || raw.eventStatus || raw.event_status ||
      ([CONFIRMED_STATUS, RECOVERY_STATUS].includes(cleanText(raw.status).trim().toLowerCase())
        ? raw.status
        : "")
  ).trim().toLowerCase();
  const legacyRecovery = cleanText(raw.eventId || raw.event_id).startsWith("snapshot:") ||
    cleanText(raw.eventId || raw.event_id).startsWith("recovery:") ||
    cleanText(raw.batchId || raw.batch_id).toLowerCase().includes("snapshot-diff") ||
    cleanText(raw.batchId || raw.batch_id).toLowerCase().includes("snapshot-recovery");
  const explicitRecovery = raw.isRecovery === true ||
    cleanText(raw.isRecovery || raw.is_recovery).trim().toLowerCase() === "true" ||
    suppliedSource === RECOVERY_SOURCE || suppliedStatus === RECOVERY_STATUS;
  const isRecovery = legacyRecovery || explicitRecovery;

  return {
    source: isRecovery ? RECOVERY_SOURCE : (suppliedSource || CONFIRMED_SOURCE),
    status: isRecovery ? RECOVERY_STATUS : (suppliedStatus || CONFIRMED_STATUS),
    isRecovery
  };
}

export function normalizeEditEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const taskId = cleanText(raw.taskId || raw.task_id).trim();
  const column = cleanText(raw.column).trim().toUpperCase();
  const action = cleanText(raw.action).trim().toUpperCase();
  const editedAt = cleanText(raw.editedAt || raw.edited_at).trim();
  if (!taskId || !TRACKED_COLUMNS.has(column) || !action || !editedAt) return null;

  const provenance = provenanceFor(raw);
  return {
    eventId: cleanText(raw.eventId || raw.event_id).trim(),
    batchId: cleanText(raw.batchId || raw.batch_id).trim(),
    taskId,
    row: cleanInteger(raw.row || raw.currentRow || raw.current_row || raw.sourceRow || raw.source_row, 0),
    eventRow: cleanInteger(raw.eventRow || raw.event_row || raw.row || raw.sourceRow || raw.source_row, 0),
    column,
    field: cleanText(raw.field).trim() || (column === "C" ? "NỘI DUNG ORDER" : "NGÀY ORDER"),
    action,
    revision: Math.max(0, cleanInteger(raw.revision, 0)),
    oldValue: normalizeTrackedValue(column, raw.oldValue ?? raw.old_value),
    newValue: normalizeTrackedValue(column, raw.newValue ?? raw.new_value),
    editedAt,
    ...provenance
  };
}

export function editEventsFromPayload(payload) {
  const source = Array.isArray(payload) ? payload : payload?.events;
  if (!Array.isArray(source)) return [];
  return source.map(normalizeEditEvent).filter(Boolean);
}

function eventSort(a, b) {
  return a.editedAt.localeCompare(b.editedAt) ||
    a.eventId.localeCompare(b.eventId);
}

function anonymousEventKey(event) {
  return [
    event.taskId,
    event.column,
    event.action,
    event.revision,
    event.editedAt,
    comparableValue(event.column, event.oldValue),
    comparableValue(event.column, event.newValue),
    event.source,
    event.status
  ].join("\u0000");
}

function transitionKey(event) {
  if (event.revision <= 0) return "";
  return [
    event.taskId,
    event.column,
    event.action,
    event.revision,
    comparableValue(event.column, event.oldValue),
    comparableValue(event.column, event.newValue)
  ].join("\u0000");
}

/**
 * Merge an existing snapshot history with a potentially partial API payload.
 * A real event ID is the identity boundary: distinct IDs are never collapsed
 * merely because they repeat the same A -> B transition.
 */
export function mergeEditEvents(previousEvents, apiEvents) {
  const merged = [];
  const indexByIdentity = new Map();

  const add = (raw, preferIncoming) => {
    const event = normalizeEditEvent(raw);
    if (!event) return;
    const identity = event.eventId
      ? `id:${event.eventId}`
      : `anonymous:${anonymousEventKey(event)}`;
    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexByIdentity.set(identity, merged.length);
      merged.push(event);
      return;
    }
    // The API copy may have a refreshed current-row value. It can refresh the
    // same event, but it never replaces unrelated history entries.
    if (preferIncoming) merged[existingIndex] = event;
  };

  for (const event of previousEvents || []) add(event, false);
  for (const event of apiEvents || []) add(event, true);

  // A recovery placeholder is removed only when an official event with the
  // same revision and transition arrives. Official events with different IDs
  // remain distinct, including repeated and reverted transitions.
  const confirmedTransitions = new Set(
    merged
      .filter((event) => !event.isRecovery)
      .map(transitionKey)
      .filter(Boolean)
  );
  const recoveryTransitions = new Set();
  return merged
    .sort(eventSort)
    .filter((event) => {
      if (!event.isRecovery) return true;
      const key = transitionKey(event);
      if (key && confirmedTransitions.has(key)) return false;
      if (key && recoveryTransitions.has(key)) return false;
      if (key) recoveryTransitions.add(key);
      return true;
    });
}

export function buildEditTracking(records, rawEvents) {
  const taskIds = new Set(
    records
      .map((record) => cleanText(record.taskId).trim())
      .filter(Boolean)
  );
  const histories = new Map();

  for (const event of mergeEditEvents([], rawEvents)) {
    if (!taskIds.has(event.taskId)) continue;
    if (!histories.has(event.taskId)) histories.set(event.taskId, []);
    histories.get(event.taskId).push(event);
  }

  const summariesByTaskId = new Map();
  const history = {};
  let editedTaskCount = 0;
  let totalEditCount = 0;
  let recoveryTaskCount = 0;
  let recoveryEventCount = 0;

  for (const [taskId, events] of histories.entries()) {
    events.sort(eventSort);
    let editCount = 0;
    let contentEditCount = 0;
    let dateEditCount = 0;
    let taskRecoveryCount = 0;

    for (const event of events) {
      if (event.isRecovery) {
        taskRecoveryCount += 1;
        continue;
      }
      if (!COUNTED_ACTIONS.has(event.action)) continue;
      editCount += 1;
      if (event.column === "C") contentEditCount += 1;
      if (event.column === "J") dateEditCount += 1;
    }

    const lastEvent = events[events.length - 1];
    const summary = {
      editCount,
      contentEditCount,
      dateEditCount,
      recoveryCount: taskRecoveryCount,
      hasDateChange: dateEditCount > 0,
      lastEditedAt: lastEvent?.editedAt || ""
    };
    if (editCount > 0 || taskRecoveryCount > 0) {
      summariesByTaskId.set(taskId, summary);
      history[taskId] = events.slice().reverse();
    }
    if (editCount > 0) editedTaskCount += 1;
    if (taskRecoveryCount > 0) recoveryTaskCount += 1;
    totalEditCount += editCount;
    recoveryEventCount += taskRecoveryCount;
  }

  return {
    summariesByTaskId,
    history,
    stats: {
      trackedTaskCount: histories.size,
      editedTaskCount,
      totalEditCount,
      recoveryTaskCount,
      recoveryEventCount
    }
  };
}

export function flattenSnapshotHistory(snapshot) {
  const source = snapshot?.editHistory;
  if (!source || typeof source !== "object") return [];
  return mergeEditEvents(
    [],
    Object.values(source).flatMap((events) => Array.isArray(events) ? events : [])
  );
}

function latestFieldEvent(events, taskId, column) {
  return events
    .filter((event) => event.taskId === taskId && event.column === column)
    .sort((a, b) =>
      a.revision - b.revision ||
      eventSort(a, b)
    )
    .at(-1);
}

function sameTransition(event, column, oldValue, newValue) {
  return Boolean(event) &&
    comparableValue(column, event.oldValue) === comparableValue(column, oldValue) &&
    comparableValue(column, event.newValue) === comparableValue(column, newValue);
}

function eventChainCoversChange(events, column, oldValue, newValue) {
  const orderedEvents = events
    .sort((a, b) =>
      a.revision - b.revision ||
      eventSort(a, b)
    );
  const expectedOldValue = comparableValue(column, oldValue);
  let expectedNewValue = comparableValue(column, newValue);

  // The current value must be the end of the newest confirmed chain. Walking
  // backwards keeps older, coincidentally matching transitions from hiding a
  // genuinely missed edit.
  for (let index = orderedEvents.length - 1; index >= 0; index -= 1) {
    const event = orderedEvents[index];
    if (comparableValue(column, event.newValue) !== expectedNewValue) return false;

    const eventOldValue = comparableValue(column, event.oldValue);
    if (eventOldValue === expectedOldValue) return true;
    expectedNewValue = eventOldValue;
  }

  return false;
}

/**
 * Recovery only: compare the previous and current snapshots when the Log API
 * is late. These events are explicitly marked and never masquerade as an
 * official edit-log event.
 */
export function inferSnapshotEditEvents(
  previousRecords,
  currentRecords,
  rawEvents,
  editedAt = new Date().toISOString()
) {
  const events = mergeEditEvents([], rawEvents);
  const previousByTaskId = new Map(
    (previousRecords || [])
      .filter((record) => cleanText(record?.taskId).trim())
      .map((record) => [cleanText(record.taskId).trim(), record])
  );
  const trackedFields = [
    { column: "C", field: "NỘI DUNG ORDER", property: "detail" },
    { column: "J", field: "NGÀY ORDER", property: "orderDate" }
  ];

  for (const current of currentRecords || []) {
    const taskId = cleanText(current?.taskId).trim();
    const previous = previousByTaskId.get(taskId);
    if (!taskId || !previous) continue;

    for (const tracked of trackedFields) {
      const oldValue = normalizeTrackedValue(tracked.column, previous[tracked.property]);
      const newValue = normalizeTrackedValue(tracked.column, current[tracked.property]);
      if (comparableValue(tracked.column, oldValue) === comparableValue(tracked.column, newValue)) continue;

      const fieldEvents = events.filter(
        (event) => event.taskId === taskId && event.column === tracked.column
      );
      const latestEvent = latestFieldEvent(events, taskId, tracked.column);
      if (sameTransition(latestEvent, tracked.column, oldValue, newValue)) continue;
      if (eventChainCoversChange(fieldEvents, tracked.column, oldValue, newValue)) continue;

      const previousRevision = fieldEvents.reduce(
        (max, event) => Math.max(max, cleanInteger(event.revision, 0)),
        0
      );
      const hadEverValue = fieldEvents.some((event) =>
        comparableValue(tracked.column, event.oldValue) !== "" ||
        comparableValue(tracked.column, event.newValue) !== ""
      );
      const action = comparableValue(tracked.column, newValue) === ""
        ? "CLEAR"
        : comparableValue(tracked.column, oldValue) === "" && !hadEverValue
          ? "INITIAL"
          : "EDIT";
      const revision = action === "INITIAL" ? previousRevision : previousRevision + 1;

      events.push(normalizeEditEvent({
        eventId: `recovery:${taskId}:${tracked.column}:${editedAt}`,
        batchId: "snapshot-recovery",
        taskId,
        row: cleanInteger(current.row, 0),
        eventRow: cleanInteger(current.row, 0),
        column: tracked.column,
        field: tracked.field,
        action,
        revision,
        oldValue,
        newValue,
        editedAt,
        source: RECOVERY_SOURCE,
        trackingStatus: RECOVERY_STATUS,
        isRecovery: true
      }));
    }
  }

  return mergeEditEvents([], events);
}
