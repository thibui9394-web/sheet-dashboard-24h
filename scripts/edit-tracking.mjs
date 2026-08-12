const TRACKED_COLUMNS = new Set(["C", "J"]);
const COUNTED_ACTIONS = new Set(["EDIT", "CLEAR"]);

function cleanText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function cleanInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeEditEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const taskId = cleanText(raw.taskId || raw.task_id).trim();
  const column = cleanText(raw.column).trim().toUpperCase();
  const action = cleanText(raw.action).trim().toUpperCase();
  const editedAt = cleanText(raw.editedAt || raw.edited_at).trim();
  if (!taskId || !TRACKED_COLUMNS.has(column) || !action || !editedAt) return null;

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
    oldValue: cleanText(raw.oldValue ?? raw.old_value),
    newValue: cleanText(raw.newValue ?? raw.new_value),
    editedAt
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

export function buildEditTracking(records, rawEvents) {
  const taskIds = new Set(
    records
      .map((record) => cleanText(record.taskId).trim())
      .filter(Boolean)
  );
  const histories = new Map();

  for (const raw of rawEvents || []) {
    const event = normalizeEditEvent(raw);
    if (!event || !taskIds.has(event.taskId)) continue;
    if (!histories.has(event.taskId)) histories.set(event.taskId, []);
    histories.get(event.taskId).push(event);
  }

  const summariesByTaskId = new Map();
  const history = {};
  let editedTaskCount = 0;
  let totalEditCount = 0;

  for (const [taskId, events] of histories.entries()) {
    events.sort(eventSort);
    let editCount = 0;
    let contentEditCount = 0;
    let dateEditCount = 0;

    for (const event of events) {
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
      hasDateChange: dateEditCount > 0,
      lastEditedAt: lastEvent?.editedAt || ""
    };
    if (editCount > 0) {
      summariesByTaskId.set(taskId, summary);
      history[taskId] = events.slice().reverse();
      editedTaskCount += 1;
    }
    totalEditCount += editCount;
  }

  return {
    summariesByTaskId,
    history,
    stats: {
      trackedTaskCount: histories.size,
      editedTaskCount,
      totalEditCount
    }
  };
}

export function flattenSnapshotHistory(snapshot) {
  const source = snapshot?.editHistory;
  if (!source || typeof source !== "object") return [];
  return Object.values(source).flatMap((events) => Array.isArray(events) ? events : []);
}
