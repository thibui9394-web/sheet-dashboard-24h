var TRACKING_CONFIG = {
  SOURCE_SPREADSHEET_ID: "1QQ-FGthecJ9bl-XlwDU17ZiD8b47ilJuUs1bSkgpYvM",
  SOURCE_SHEET_GID: 131891982,
  TASK_ID_COLUMN: 27,
  TASK_ID_HEADER: "_TASK_ID",
  LOG_SHEET_NAME: "Edit_Log",
  STATE_SHEET_NAME: "Tracking_State",
  TASK_INDEX_SHEET_NAME: "Task_Index",
  TIME_ZONE: "Asia/Ho_Chi_Minh",
  TRACKED_COLUMNS: {
    3: { letter: "C", field: "NỘI DUNG ORDER" },
    10: { letter: "J", field: "NGÀY ORDER" }
  }
};

var LOG_HEADERS = [
  "MÃ SỰ KIỆN",
  "MÃ THAO TÁC",
  "MÃ TASK",
  "DÒNG KHI GHI LOG",
  "CỘT",
  "TRƯỜNG DỮ LIỆU",
  "LOẠI THAY ĐỔI",
  "LẦN SỬA",
  "GIÁ TRỊ CŨ",
  "GIÁ TRỊ MỚI",
  "THỜI GIAN SỬA",
  "TÀI KHOẢN SỬA (DỮ LIỆU CŨ - KHÔNG THU THẬP MỚI)",
  "DÒNG LÚC SỬA",
  "NGUỒN SỰ KIỆN",
  "TRẠNG THÁI GHI",
  "MÃ CHỐNG TRÙNG"
];

// Header da dung truoc khi event log duoc bo sung provenance/idempotency.
// Giu danh sach rieng de nang cap tai cho ma khong sua/xoa event cu.
var V2_LOG_HEADERS = [
  "MÃ SỰ KIỆN", "MÃ THAO TÁC", "MÃ TASK", "DÒNG HIỆN TẠI", "CỘT", "TRƯỜNG DỮ LIỆU",
  "LOẠI THAY ĐỔI", "LẦN SỬA", "GIÁ TRỊ CŨ", "GIÁ TRỊ MỚI", "THỜI GIAN SỬA", "TÀI KHOẢN SỬA",
  "DÒNG LÚC SỬA"
];

var PREVIOUS_LOG_HEADERS = [
  "MÃ SỰ KIỆN", "MÃ THAO TÁC", "MÃ TASK", "DÒNG NGUỒN", "CỘT", "TRƯỜNG DỮ LIỆU",
  "LOẠI THAY ĐỔI", "LẦN SỬA", "GIÁ TRỊ CŨ", "GIÁ TRỊ MỚI", "THỜI GIAN SỬA", "TÀI KHOẢN SỬA"
];

var STATE_HEADERS = [
  "KHÓA TRẠNG THÁI",
  "MÃ TASK",
  "CỘT",
  "GIÁ TRỊ HIỆN TẠI",
  "LẦN SỬA",
  "ĐÃ TỪNG CÓ DỮ LIỆU",
  "CẬP NHẬT LÚC"
];

var TASK_INDEX_HEADERS = [
  "MÃ TASK",
  "DÒNG HIỆN TẠI",
  "TRẠNG THÁI",
  "CẬP NHẬT LÚC",
  "NGUỒN CẬP NHẬT",
  "DÒNG HOẠT ĐỘNG CUỐI"
];

var TASK_STATUS_ACTIVE = "ACTIVE";
var TASK_STATUS_DELETED = "ĐÃ XÓA";

var LEGACY_LOG_HEADERS = [
  "EVENT_ID", "BATCH_ID", "TASK_ID", "SOURCE_ROW", "COLUMN", "FIELD",
  "ACTION", "REVISION", "OLD_VALUE", "NEW_VALUE", "EDITED_AT", "EDITOR_EMAIL"
];

var LEGACY_STATE_HEADERS = [
  "STATE_KEY", "TASK_ID", "COLUMN", "CURRENT_VALUE", "REVISION",
  "HAS_EVER_VALUE", "UPDATED_AT"
];

/**
 * Chay mot lan bang tai khoan admin.
 * Ham nay tao file log rieng, gan Task ID, tao baseline va cai trigger edit.
 */
function setupTracking() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var properties = PropertiesService.getScriptProperties();
    var source = SpreadsheetApp.openById(TRACKING_CONFIG.SOURCE_SPREADSHEET_ID);
    var sourceSheet = getSheetById_(source, TRACKING_CONFIG.SOURCE_SHEET_GID);
    ensureTaskIdColumn_(sourceSheet);
    var logBook = getOrCreateLogBook_(properties);
    var logSheet = ensureSheet_(logBook, TRACKING_CONFIG.LOG_SHEET_NAME, LOG_HEADERS);
    var stateSheet = ensureSheet_(logBook, TRACKING_CONFIG.STATE_SHEET_NAME, STATE_HEADERS);
    var taskIndexSheet = ensureSheet_(logBook, TRACKING_CONFIG.TASK_INDEX_SHEET_NAME, TASK_INDEX_HEADERS);
    backfillLogProvenance_(logSheet);
    sanitizeTrackingFormulaCells_(logSheet, stateSheet);

    // Giu Task ID canonical theo Task_Index truoc khi baseline doc/gan lich su.
    // Neu co ban copy trung ma nam tren dong canonical, baseline khong duoc phep
    // "danh truoc thang" va chuyen lich su cua task sang ban copy.
    reconcileSourceTaskIds_(sourceSheet, taskIndexSheet);
    var baseline = initializeBaseline_(sourceSheet, logSheet, stateSheet);
    ensureEditTrigger_();
    ensureStructureTrigger_();
    ensurePeriodicTrigger_();
    var rowSync = reconcileTracking_(sourceSheet, logSheet, stateSheet, taskIndexSheet, "SETUP_RECONCILE");

    if (!properties.getProperty("API_TOKEN")) {
      properties.setProperty("API_TOKEN", createToken_());
    }
    properties.setProperty("TRACKING_VERSION", "3");
    properties.setProperty("TRACKING_INSTALLED_AT", new Date().toISOString());

    var result = {
      ok: true,
      sourceSheet: sourceSheet.getName(),
      logSpreadsheetId: logBook.getId(),
      logSpreadsheetUrl: logBook.getUrl(),
      initializedTasks: baseline.taskCount,
      baselineEvents: baseline.eventCount,
      activeTasks: rowSync.activeTasks,
      deletedTasks: rowSync.deletedTasks,
      duplicateIdsFixed: rowSync.duplicateIdsFixed,
      recoveredEvents: rowSync.recoveredEvents,
      hasApiToken: Boolean(properties.getProperty("API_TOKEN"))
    };
    console.log("SETUP_RESULT=" + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Installable onEdit handler. Khong goi truc tiep. */
function onTrackedEdit(e) {
  if (!e || !e.range) return;
  var sourceSheet = e.range.getSheet();
  if (sourceSheet.getSheetId() !== TRACKING_CONFIG.SOURCE_SHEET_GID) return;
  if (e.range.getLastRow() < 2) return;
  if (!rangeTouchesTrackedColumn_(e.range)) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var properties = PropertiesService.getScriptProperties();
    var logBookId = properties.getProperty("LOG_SPREADSHEET_ID");
    if (!logBookId) throw new Error("Tracking chua duoc setup.");

    var logBook = SpreadsheetApp.openById(logBookId);
    var logSheet = ensureSheet_(logBook, TRACKING_CONFIG.LOG_SHEET_NAME, LOG_HEADERS);
    var stateSheet = ensureSheet_(logBook, TRACKING_CONFIG.STATE_SHEET_NAME, STATE_HEADERS);
    var taskIndexSheet = ensureSheet_(logBook, TRACKING_CONFIG.TASK_INDEX_SHEET_NAME, TASK_INDEX_HEADERS);
    var stateMap = readStateMap_(stateSheet);
    var taskIndexMap = readTaskIndexMap_(taskIndexSheet);
    var knownEventKeys = readEventKeySet_(logSheet);
    var batchId = Utilities.getUuid();
    var editedAt = new Date().toISOString();
    var logRows = [];
    var stateDirty = false;

    var firstRow = Math.max(2, e.range.getRow());
    var lastRow = e.range.getLastRow();
    var firstColumn = e.range.getColumn();
    var lastColumn = e.range.getLastColumn();

    for (var row = firstRow; row <= lastRow; row += 1) {
      var taskId = getOrCreateTaskId_(sourceSheet, row, taskIndexMap);
      for (var column = firstColumn; column <= lastColumn; column += 1) {
        var tracked = TRACKING_CONFIG.TRACKED_COLUMNS[column];
        if (!tracked) continue;

        var newValue = normalizeTrackedValue_(tracked.letter, sourceSheet.getRange(row, column).getDisplayValue());
        var stateKey = taskId + "|" + tracked.letter;
        var state = stateMap[stateKey] || null;
        var stateValue = normalizeTrackedValue_(tracked.letter, state ? state.currentValue : "");
        var hasObservedOldValue = isSingleCellEdit_(e, row, column);
        var observedOldValue = normalizeTrackedValue_(tracked.letter, getSingleCellOldValue_(e, row, column));
        if (state && hasObservedOldValue && stateValue !== observedOldValue) {
          var recoveryAction = determineAction_(stateValue, observedOldValue, state.hasEverValue);
          var recoveryRevision = state.revision;
          if (recoveryAction === "EDIT" || recoveryAction === "CLEAR") recoveryRevision += 1;
          var recoveryKey = createEventKey_(
            taskId,
            tracked.letter,
            recoveryAction,
            recoveryRevision,
            stateValue,
            observedOldValue
          );
          if (recoveryAction && !knownEventKeys[recoveryKey]) {
            logRows.push(createLogEventRow_({
              batchId: batchId,
              taskId: taskId,
              row: row,
              column: tracked.letter,
              field: tracked.field,
              action: recoveryAction,
              revision: recoveryRevision,
              oldValue: stateValue,
              newValue: observedOldValue,
              editedAt: editedAt,
              source: "PRE_EDIT_RECONCILE",
              recordStatus: "RECOVERY",
              eventKey: recoveryKey
            }));
            knownEventKeys[recoveryKey] = true;
          }
          state = {
            currentValue: observedOldValue,
            revision: recoveryRevision,
            hasEverValue: state.hasEverValue || Boolean(observedOldValue)
          };
        }
        var oldValue = state
          ? normalizeTrackedValue_(tracked.letter, state.currentValue)
          : observedOldValue;
        if (String(oldValue) === String(newValue)) continue;

        var hasEverValue = state ? state.hasEverValue : String(oldValue) !== "";
        var action = determineAction_(oldValue, newValue, hasEverValue);
        if (!action) continue;

        var revision = state ? state.revision : 0;
        if (action === "EDIT" || action === "CLEAR") revision += 1;
        var nextHasEverValue = hasEverValue || String(newValue) !== "";
        var eventKey = createEventKey_(taskId, tracked.letter, action, revision, oldValue, newValue);

        if (!knownEventKeys[eventKey]) {
          logRows.push(createLogEventRow_({
            batchId: batchId,
            taskId: taskId,
            row: row,
            column: tracked.letter,
            field: tracked.field,
            action: action,
            revision: revision,
            oldValue: oldValue,
            newValue: newValue,
            editedAt: editedAt,
            source: "EDIT_TRIGGER",
            recordStatus: "CONFIRMED",
            eventKey: eventKey
          }));
          knownEventKeys[eventKey] = true;
        }

        upsertState_(stateSheet, stateMap, {
          key: stateKey,
          taskId: taskId,
          column: tracked.letter,
          currentValue: String(newValue),
          revision: revision,
          hasEverValue: nextHasEverValue,
          updatedAt: editedAt
        });
        stateDirty = true;
      }

    }

    appendLogRows_(logSheet, logRows);
    if (stateDirty) writeStateMap_(stateSheet, stateMap);
    syncTaskIndex_(sourceSheet, logSheet, taskIndexSheet, "EDIT_TRIGGER");
  } finally {
    lock.releaseLock();
  }
}

/**
 * Endpoint chi tra du lieu an danh cho GitHub Action.
 * Tracking v3 khong thu thap va khong tra danh tinh nguoi sua.
 */
function doGet(e) {
  var properties = PropertiesService.getScriptProperties();
  var expectedToken = properties.getProperty("API_TOKEN") || "";
  var suppliedToken = e && e.parameter ? String(e.parameter.token || "") : "";
  if (!expectedToken || suppliedToken !== expectedToken) {
    return jsonResponse_({ ok: false, error: "Unauthorized" });
  }

  var logBookId = properties.getProperty("LOG_SPREADSHEET_ID");
  if (!logBookId) return jsonResponse_({ ok: false, error: "Tracking is not configured" });
  var logBook = SpreadsheetApp.openById(logBookId);
  var logSheet = ensureSheet_(logBook, TRACKING_CONFIG.LOG_SHEET_NAME, LOG_HEADERS);
  var taskIndexSheet = ensureSheet_(logBook, TRACKING_CONFIG.TASK_INDEX_SHEET_NAME, TASK_INDEX_HEADERS);
  var taskIndexMap = readTaskIndexMap_(taskIndexSheet);
  var source = SpreadsheetApp.openById(TRACKING_CONFIG.SOURCE_SPREADSHEET_ID);
  var sourceSheet = getSheetById_(source, TRACKING_CONFIG.SOURCE_SHEET_GID);
  var liveLocations = readSourceTaskLocations_(sourceSheet, true);
  var logDataRange = logSheet.getDataRange();
  var values = logDataRange.getDisplayValues();
  var formulas = logDataRange.getFormulas();
  var events = [];

  for (var index = 1; index < values.length; index += 1) {
    var row = values[index];
    if (!row[2] || !row[10]) continue;
    var taskId = String(row[2]);
    var locations = liveLocations[taskId] || [];
    var indexState = taskIndexMap[taskId] || null;
    var currentRow = 0;
    var taskStatus = TASK_STATUS_DELETED;
    if (locations.length === 1) {
      currentRow = locations[0];
      taskStatus = TASK_STATUS_ACTIVE;
    } else if (locations.length > 1) {
      taskStatus = "TRÙNG MÃ";
    } else if (indexState && indexState.status && indexState.status !== TASK_STATUS_ACTIVE) {
      taskStatus = indexState.status;
    }
    var eventColumn = String(row[4] || "").toUpperCase();
    var eventOldValue = normalizeTrackedValue_(eventColumn, (formulas[index] && formulas[index][8]) || row[8]);
    var eventNewValue = normalizeTrackedValue_(eventColumn, (formulas[index] && formulas[index][9]) || row[9]);
    if ((eventColumn === "C" || eventColumn === "J") && eventOldValue === eventNewValue) continue;
    var recordStatus = String(row[14] || "CONFIRMED");
    var isRecovery = recordStatus !== "CONFIRMED";
    events.push({
      eventId: row[0],
      batchId: row[1],
      taskId: taskId,
      row: currentRow,
      eventRow: Number(row[12] || row[3] || 0),
      column: row[4],
      field: row[5],
      action: row[6],
      revision: Number(row[7] || 0),
      oldValue: eventOldValue,
      newValue: eventNewValue,
      editedAt: row[10],
      source: row[13] || "LEGACY",
      recordStatus: recordStatus,
      trackingStatus: isRecovery ? "recovery" : "confirmed",
      isRecovery: isRecovery,
      taskStatus: taskStatus
    });
  }

  return jsonResponse_({
    ok: true,
    version: 3,
    generatedAt: new Date().toISOString(),
    trackingHealth: getTrackingHealth_(),
    events: events
  });
}

function getTrackingStatus() {
  var properties = PropertiesService.getScriptProperties();
  return {
    installedAt: properties.getProperty("TRACKING_INSTALLED_AT"),
    trackingVersion: properties.getProperty("TRACKING_VERSION"),
    logSpreadsheetId: properties.getProperty("LOG_SPREADSHEET_ID"),
    hasApiToken: Boolean(properties.getProperty("API_TOKEN")),
    collectsEditorIdentity: false,
    health: getTrackingHealth_(),
    triggers: ScriptApp.getProjectTriggers().map(function(trigger) {
      return trigger.getHandlerFunction();
    })
  };
}

/** Installable onChange handler. Dong bo so dong sau khi chen, xoa hoac sap xep dong. */
function onTrackedStructureChange(e) {
  var changeType = e && e.changeType ? String(e.changeType) : "";
  if (changeType === "EDIT" || changeType === "FORMAT") return;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var properties = PropertiesService.getScriptProperties();
    var logBookId = properties.getProperty("LOG_SPREADSHEET_ID");
    if (!logBookId) return;

    var source = SpreadsheetApp.openById(TRACKING_CONFIG.SOURCE_SPREADSHEET_ID);
    var sourceSheet = getSheetById_(source, TRACKING_CONFIG.SOURCE_SHEET_GID);
    var logBook = SpreadsheetApp.openById(logBookId);
    var logSheet = ensureSheet_(logBook, TRACKING_CONFIG.LOG_SHEET_NAME, LOG_HEADERS);
    var stateSheet = ensureSheet_(logBook, TRACKING_CONFIG.STATE_SHEET_NAME, STATE_HEADERS);
    var taskIndexSheet = ensureSheet_(logBook, TRACKING_CONFIG.TASK_INDEX_SHEET_NAME, TASK_INDEX_HEADERS);
    reconcileTracking_(
      sourceSheet,
      logSheet,
      stateSheet,
      taskIndexSheet,
      "STRUCTURE_" + (changeType || "UNKNOWN")
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Chay thu cong de doi soat Task ID, Task_Index va khoi phuc event bi bo sot.
 * Ham khong sua lai bat ky event da ghi trong Edit_Log.
 */
function syncCurrentRows() {
  return reconcileCurrentRowsWithLabel_("MANUAL_RECONCILE");
}

/** Tu kiem tra doGet bang token noi bo ma khong in/tra token ra log. */
function selfTestTrackingApi() {
  var token = PropertiesService.getScriptProperties().getProperty("API_TOKEN") || "";
  var payload = JSON.parse(doGet({ parameter: { token: token } }).getContent());
  var result = {
    ok: payload.ok === true,
    version: payload.version || 0,
    eventCount: Array.isArray(payload.events) ? payload.events.length : 0,
    trackingHealth: payload.trackingHealth || null
  };
  console.log("API_SELF_TEST=" + JSON.stringify(result));
  return result;
}

function reconcileCurrentRowsWithLabel_(sourceLabel) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var properties = PropertiesService.getScriptProperties();
    var logBookId = properties.getProperty("LOG_SPREADSHEET_ID");
    if (!logBookId) throw new Error("Tracking chua duoc setup.");

    var source = SpreadsheetApp.openById(TRACKING_CONFIG.SOURCE_SPREADSHEET_ID);
    var sourceSheet = getSheetById_(source, TRACKING_CONFIG.SOURCE_SHEET_GID);
    var logBook = SpreadsheetApp.openById(logBookId);
    var logSheet = ensureSheet_(logBook, TRACKING_CONFIG.LOG_SHEET_NAME, LOG_HEADERS);
    var stateSheet = ensureSheet_(logBook, TRACKING_CONFIG.STATE_SHEET_NAME, STATE_HEADERS);
    var taskIndexSheet = ensureSheet_(logBook, TRACKING_CONFIG.TASK_INDEX_SHEET_NAME, TASK_INDEX_HEADERS);
    var result = reconcileTracking_(sourceSheet, logSheet, stateSheet, taskIndexSheet, sourceLabel);
    console.log("ROW_SYNC_RESULT=" + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Doi soat dinh ky de bat cac thay doi qua API/script khong kich hoat onEdit. */
function onTrackedPeriodicReconcile() {
  return reconcileCurrentRowsWithLabel_("PERIODIC_RECONCILE");
}

/** Tam dung ghi log, khong xoa Task ID hay lich su. Chay setupTracking de bat lai. */
function pauseTracking() {
  var deleted = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "onTrackedEdit" ||
        trigger.getHandlerFunction() === "onTrackedStructureChange" ||
        trigger.getHandlerFunction() === "onTrackedPeriodicReconcile") {
      ScriptApp.deleteTrigger(trigger);
      deleted += 1;
    }
  });
  console.log("Da tam dung " + deleted + " trigger tracking.");
  return { ok: true, deletedTriggers: deleted };
}

function ensureTaskIdColumn_(sheet) {
  var column = TRACKING_CONFIG.TASK_ID_COLUMN;
  if (sheet.getMaxColumns() < column) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), column - sheet.getMaxColumns());
  }
  var headerCell = sheet.getRange(1, column);
  var currentHeader = String(headerCell.getDisplayValue() || "").trim();
  if (currentHeader && currentHeader !== TRACKING_CONFIG.TASK_ID_HEADER) {
    throw new Error("Cot AA dang co du lieu. Khong the tao _TASK_ID an toan.");
  }
  if (!currentHeader && sheet.getLastRow() >= 2) {
    var existingTaskColumn = sheet
      .getRange(2, column, sheet.getLastRow() - 1, 1)
      .getDisplayValues();
    var firstOccupiedOffset = existingTaskColumn.findIndex(function(row) {
      return String(row[0] || "").trim() !== "";
    });
    if (firstOccupiedOffset !== -1) {
      throw new Error(
        "Cot AA co du lieu o dong " + (firstOccupiedOffset + 2) +
        ". Dung setup de tranh ghi de du lieu hien tai."
      );
    }
  }
  headerCell.setValue(TRACKING_CONFIG.TASK_ID_HEADER);
  sheet.hideColumns(column);
  protectTaskIdColumn_(sheet);
}

function protectTaskIdColumn_(sheet) {
  var description = "TRACKING_TASK_ID_DO_NOT_EDIT";
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var protection = null;
  for (var index = 0; index < protections.length; index += 1) {
    if (protections[index].getDescription() === description) {
      protection = protections[index];
      break;
    }
  }
  var protectedRange = sheet.getRange(1, TRACKING_CONFIG.TASK_ID_COLUMN, sheet.getMaxRows(), 1);
  if (!protection) protection = protectedRange.protect();
  protection.setDescription(description);
  protection.setRange(protectedRange);
  protection.setWarningOnly(false);

  // Installable trigger chay bang tai khoan cai tracking, nen tai khoan nay van
  // cap/doi Task ID duoc; editor cua Sheet khong the paste/de/sua cot AA.
  var owner = Session.getEffectiveUser();
  protection.addEditor(owner);
  var ownerEmail = String(owner.getEmail() || "");
  var removableEditors = protection.getEditors().filter(function(user) {
    return String(user.getEmail() || "") !== ownerEmail;
  });
  if (removableEditors.length > 0) protection.removeEditors(removableEditors);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
}

function initializeBaseline_(sourceSheet, logSheet, stateSheet) {
  var lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) return { taskCount: 0, eventCount: 0 };

  var rowCount = lastRow - 1;
  var contentValues = sourceSheet.getRange(2, 3, rowCount, 1).getDisplayValues();
  var dateValues = sourceSheet.getRange(2, 10, rowCount, 1).getDisplayValues();
  var idRange = sourceSheet.getRange(2, TRACKING_CONFIG.TASK_ID_COLUMN, rowCount, 1);
  var idValues = idRange.getDisplayValues();
  var stateMap = readStateMap_(stateSheet);
  var knownEventKeys = readEventKeySet_(logSheet);
  var logRows = [];
  var now = new Date().toISOString();
  var changedIds = false;
  var taskCount = 0;
  var seenTaskIds = {};

  for (var index = 0; index < rowCount; index += 1) {
    var content = normalizeTrackedValue_("C", contentValues[index][0]);
    var orderDate = normalizeTrackedValue_("J", dateValues[index][0]);
    if (!content && !orderDate) continue;

    taskCount += 1;
    var taskId = String(idValues[index][0] || "").trim();
    if (!taskId || seenTaskIds[taskId]) {
      taskId = Utilities.getUuid();
      idValues[index][0] = taskId;
      changedIds = true;
    }
    seenTaskIds[taskId] = true;

    var fields = [
      { column: "C", field: "NỘI DUNG ORDER", value: content },
      { column: "J", field: "NGÀY ORDER", value: orderDate }
    ];
    for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      var fieldInfo = fields[fieldIndex];
      var stateKey = taskId + "|" + fieldInfo.column;
      if (stateMap[stateKey]) continue;
      upsertState_(stateSheet, stateMap, {
        key: stateKey,
        taskId: taskId,
        column: fieldInfo.column,
        currentValue: fieldInfo.value,
        revision: 0,
        hasEverValue: Boolean(fieldInfo.value),
        updatedAt: now
      });
      if (fieldInfo.value) {
        var eventKey = createEventKey_(taskId, fieldInfo.column, "BASELINE", 0, "", fieldInfo.value);
        if (!knownEventKeys[eventKey]) {
          logRows.push(createLogEventRow_({
            batchId: "setup",
            taskId: taskId,
            row: index + 2,
            column: fieldInfo.column,
            field: fieldInfo.field,
            action: "BASELINE",
            revision: 0,
            oldValue: "",
            newValue: fieldInfo.value,
            editedAt: now,
            source: "SETUP_BASELINE",
            recordStatus: "CONFIRMED",
            eventKey: eventKey
          }));
          knownEventKeys[eventKey] = true;
        }
      }
    }
  }

  if (changedIds) idRange.setValues(idValues);
  writeStateMap_(stateSheet, stateMap);
  appendLogRows_(logSheet, logRows);
  return { taskCount: taskCount, eventCount: logRows.length };
}

function getOrCreateTaskId_(sheet, row, taskIndexMap) {
  var cell = sheet.getRange(row, TRACKING_CONFIG.TASK_ID_COLUMN);
  var taskId = String(cell.getDisplayValue() || "").trim();
  if (taskId) {
    var lastRow = sheet.getLastRow();
    var matches = lastRow < 2 ? [] : sheet
      .getRange(2, TRACKING_CONFIG.TASK_ID_COLUMN, lastRow - 1, 1)
      .createTextFinder(taskId)
      .matchEntireCell(true)
      .findAll();
    if (matches.length > 1) {
      var indexedRow = taskIndexMap && taskIndexMap[taskId]
        ? Number(taskIndexMap[taskId].currentRow || taskIndexMap[taskId].lastActiveRow || 0)
        : 0;
      var canonicalRow = matches.reduce(function(best, match) {
        var matchRow = match.getRow();
        if (indexedRow && matchRow === indexedRow) return matchRow;
        if (indexedRow && best === indexedRow) return best;
        return Math.min(best, matchRow);
      }, matches[0].getRow());
      if (row !== canonicalRow) taskId = "";
    }
  }
  if (!taskId) {
    taskId = Utilities.getUuid();
    cell.setValue(taskId);
  }
  return taskId;
}

function readStateMap_(stateSheet) {
  var stateRange = stateSheet.getDataRange();
  var values = stateRange.getDisplayValues();
  var formulas = stateRange.getFormulas();
  var map = {};
  for (var index = 1; index < values.length; index += 1) {
    var row = values[index];
    if (!row[0]) continue;
    map[row[0]] = {
      rowNumber: index + 1,
      key: row[0],
      taskId: row[1],
      column: row[2],
      currentValue: normalizeTrackedValue_(row[2], (formulas[index] && formulas[index][3]) || row[3]),
      revision: Number(row[4] || 0),
      hasEverValue: String(row[5]).toLowerCase() === "true",
      updatedAt: row[6]
    };
  }
  return map;
}

function upsertState_(stateSheet, stateMap, state) {
  var existing = stateMap[state.key];
  var rowNumber = existing ? existing.rowNumber : Object.keys(stateMap).length + 2;
  stateMap[state.key] = {
    rowNumber: rowNumber,
    key: state.key,
    taskId: state.taskId,
    column: state.column,
    currentValue: normalizeTrackedValue_(state.column, state.currentValue),
    revision: state.revision,
    hasEverValue: state.hasEverValue,
    updatedAt: state.updatedAt
  };
}

function writeStateMap_(stateSheet, stateMap) {
  var states = Object.keys(stateMap).map(function(key) { return stateMap[key]; });
  states.sort(function(a, b) { return a.rowNumber - b.rowNumber; });
  if (states.length === 0) return;
  var rows = states.map(function(state) {
    return [
      state.key,
      state.taskId,
      state.column,
      forceSheetText_(state.currentValue),
      state.revision,
      state.hasEverValue,
      state.updatedAt
    ];
  });
  ensureRowCapacity_(stateSheet, rows.length + 1);
  stateSheet.getRange(2, 1, rows.length, STATE_HEADERS.length).setValues(rows);
}

function normalizeTrackedValue_(column, value) {
  var columnName = String(column || "").toUpperCase();
  if (columnName !== "J") return String(value === null || value === undefined ? "" : value).replace(/\r\n?/g, "\n");

  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, TRACKING_CONFIG.TIME_ZONE, "yyyy-MM-dd");
  }

  var text = String(value === null || value === undefined ? "" : value).trim();
  if (!text) return "";
  var match = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/);
  var year;
  var month;
  var day;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:\s+.*)?$/);
    if (!match) return text;
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  }
  var candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return text;
  }
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function escapeSheetText_(value) {
  var text = String(value === null || value === undefined ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function forceSheetText_(value) {
  var text = String(value === null || value === undefined ? "" : value);
  return text ? "'" + text : "";
}

function sanitizeTrackingFormulaCells_(logSheet, stateSheet) {
  neutralizeFormulaColumns_(logSheet, [9, 10]);
  neutralizeFormulaColumns_(stateSheet, [4]);
}

function neutralizeFormulaColumns_(sheet, columns) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  columns.forEach(function(column) {
    var range = sheet.getRange(2, column, lastRow - 1, 1);
    var formulas = range.getFormulas();
    formulas.forEach(function(row, index) {
      if (!row[0]) return;
      sheet.getRange(index + 2, column).setValue(escapeSheetText_(row[0]));
    });
  });
}

function determineAction_(oldValue, newValue, hasEverValue) {
  var oldText = String(oldValue || "");
  var newText = String(newValue || "");
  if (oldText === newText) return "";
  if (!hasEverValue && !oldText && newText) return "INITIAL";
  if (oldText && !newText) return "CLEAR";
  return "EDIT";
}

function getSingleCellOldValue_(e, row, column) {
  if (isSingleCellEdit_(e, row, column)) {
    return e.oldValue === undefined ? "" : String(e.oldValue);
  }
  return "";
}

function isSingleCellEdit_(e, row, column) {
  return e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 &&
    e.range.getRow() === row && e.range.getColumn() === column;
}

function rangeTouchesTrackedColumn_(range) {
  var first = range.getColumn();
  var last = range.getLastColumn();
  return Object.keys(TRACKING_CONFIG.TRACKED_COLUMNS).some(function(column) {
    var value = Number(column);
    return value >= first && value <= last;
  });
}

function getOrCreateLogBook_(properties) {
  var logBookId = properties.getProperty("LOG_SPREADSHEET_ID");
  if (logBookId) return SpreadsheetApp.openById(logBookId);
  var logBook = SpreadsheetApp.create("Design Team - Edit Log");
  logBook.setSpreadsheetTimeZone(TRACKING_CONFIG.TIME_ZONE);
  properties.setProperty("LOG_SPREADSHEET_ID", logBook.getId());
  return logBook;
}

function ensureSheet_(book, name, headers) {
  var sheet = book.getSheetByName(name);
  if (!sheet) {
    var sheets = book.getSheets();
    sheet = sheets.length === 1 && sheets[0].getLastRow() === 0 ? sheets[0] : book.insertSheet();
    sheet.setName(name);
  }
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var existing = headerRange.getDisplayValues()[0];
  var isEmpty = existing.every(function(value) { return !value; });
  if (isEmpty) {
    headerRange.setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (existing.join("|") !== headers.join("|")) {
    if (name === TRACKING_CONFIG.LOG_SHEET_NAME && migrateLogSheet_(sheet, headers)) {
      return sheet;
    }
    var legacyHeaders = name === TRACKING_CONFIG.LOG_SHEET_NAME
      ? LEGACY_LOG_HEADERS
      : LEGACY_STATE_HEADERS;
    if (existing.join("|") === legacyHeaders.join("|")) {
      headerRange.setValues([headers]);
    } else {
      throw new Error("Sai tiêu đề trong sheet " + name + ".");
    }
  }
  return sheet;
}

function ensureRowCapacity_(sheet, requiredLastRow) {
  var maxRows = sheet.getMaxRows();
  if (requiredLastRow <= maxRows) return;
  sheet.insertRowsAfter(maxRows, Math.max(requiredLastRow - maxRows, 100));
}

function migrateLogSheet_(sheet, headers) {
  var v2Headers = sheet.getRange(1, 1, 1, V2_LOG_HEADERS.length).getDisplayValues()[0];
  var isV2 = v2Headers.join("|") === V2_LOG_HEADERS.join("|");
  var oldHeaderCount = PREVIOUS_LOG_HEADERS.length;
  var oldHeaders = sheet.getRange(1, 1, 1, oldHeaderCount).getDisplayValues()[0];
  var isPreviousVietnamese = oldHeaders.join("|") === PREVIOUS_LOG_HEADERS.join("|");
  var isLegacyEnglish = oldHeaders.join("|") === LEGACY_LOG_HEADERS.join("|");
  if (!isV2 && !isPreviousVietnamese && !isLegacyEnglish) return false;

  var lastRow = sheet.getLastRow();
  if (!isV2 && lastRow >= 2) {
    var rowCount = lastRow - 1;
    var currentRows = sheet.getRange(2, 4, rowCount, 1).getDisplayValues();
    sheet.getRange(2, 13, rowCount, 1).setValues(currentRows);
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return true;
}

function appendLogRows_(logSheet, rows) {
  if (!rows || rows.length === 0) return 0;
  var startRow = logSheet.getLastRow() + 1;
  ensureRowCapacity_(logSheet, startRow + rows.length - 1);
  logSheet.getRange(startRow, 1, rows.length, LOG_HEADERS.length).setValues(rows);
  return rows.length;
}

function backfillLogProvenance_(logSheet) {
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return 0;
  var rowCount = lastRow - 1;
  var rows = logSheet.getRange(2, 1, rowCount, LOG_HEADERS.length).getDisplayValues();
  var provenance = [];
  var changed = 0;
  rows.forEach(function(row) {
    var source = String(row[13] || "").trim();
    var status = String(row[14] || "").trim();
    var eventKey = String(row[15] || "").trim();
    if (!source) {
      source = "LEGACY_IMPORT";
      changed += 1;
    }
    if (!status) {
      // V1/V2 chi duoc ghi boi baseline hoac installable onEdit; chua co
      // co che recovery synthetic, nen co the migrate thanh confirmed.
      status = "CONFIRMED";
      changed += 1;
    }
    if (!eventKey && row[2] && row[4] && row[6]) {
      eventKey = createEventKey_(row[2], row[4], row[6], Number(row[7] || 0), row[8], row[9]);
      changed += 1;
    }
    provenance.push([source, status, eventKey]);
  });
  if (changed > 0) logSheet.getRange(2, 14, rowCount, 3).setValues(provenance);
  return changed;
}

function createLogEventRow_(info) {
  var normalizedOldValue = normalizeTrackedValue_(info.column, info.oldValue);
  var normalizedNewValue = normalizeTrackedValue_(info.column, info.newValue);
  var eventKey = String(info.eventKey || createEventKey_(
    info.taskId,
    info.column,
    info.action,
    info.revision,
    normalizedOldValue,
    normalizedNewValue
  ));
  return [
    "evt_" + eventKey.substring(0, 32),
    String(info.batchId || Utilities.getUuid()),
    String(info.taskId || ""),
    Number(info.row || 0),
    String(info.column || ""),
    String(info.field || ""),
    String(info.action || ""),
    Number(info.revision || 0),
    forceSheetText_(normalizedOldValue),
    forceSheetText_(normalizedNewValue),
    String(info.editedAt || new Date().toISOString()),
    "", // Cot tai khoan chi duoc giu de tuong thich du lieu cu; v3 khong thu thap danh tinh.
    Number(info.row || 0),
    String(info.source || "UNKNOWN"),
    String(info.recordStatus || "CONFIRMED"),
    eventKey
  ];
}

function createEventKey_(taskId, column, action, revision, oldValue, newValue) {
  var normalizedOldValue = normalizeTrackedValue_(column, oldValue);
  var normalizedNewValue = normalizeTrackedValue_(column, newValue);
  var source = [
    String(taskId || ""),
    String(column || ""),
    String(action || ""),
    String(Number(revision || 0)),
    normalizedOldValue,
    normalizedNewValue
  ].join("\u001f");
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    source,
    Utilities.Charset.UTF_8
  );
  return digest.map(function(value) {
    return ((value + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function readEventKeySet_(logSheet) {
  var result = {};
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return result;
  var rows = logSheet.getRange(2, 1, lastRow - 1, LOG_HEADERS.length).getDisplayValues();
  rows.forEach(function(row) {
    var taskId = String(row[2] || "").trim();
    var column = String(row[4] || "").trim();
    var action = String(row[6] || "").trim();
    if (!taskId || !column || !action) return;
    var key = String(row[15] || "").trim() || createEventKey_(
      taskId,
      column,
      action,
      Number(row[7] || 0),
      row[8],
      row[9]
    );
    result[key] = true;
  });
  return result;
}

function readTaskIndexMap_(taskIndexSheet) {
  var result = {};
  var lastRow = taskIndexSheet.getLastRow();
  if (lastRow < 2) return result;
  var rows = taskIndexSheet
    .getRange(2, 1, lastRow - 1, TASK_INDEX_HEADERS.length)
    .getDisplayValues();
  rows.forEach(function(row, index) {
    var taskId = String(row[0] || "").trim();
    if (!taskId) return;
    result[taskId] = {
      rowNumber: index + 2,
      taskId: taskId,
      currentRow: Number(row[1] || 0),
      status: String(row[2] || ""),
      updatedAt: String(row[3] || ""),
      source: String(row[4] || ""),
      lastActiveRow: Number(row[5] || row[1] || 0)
    };
  });
  return result;
}

function readSourceTaskLocations_(sourceSheet, includeBlankRows) {
  var result = {};
  var lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) return result;
  var rowCount = lastRow - 1;
  var contents = sourceSheet.getRange(2, 3, rowCount, 1).getDisplayValues();
  var dates = sourceSheet.getRange(2, 10, rowCount, 1).getDisplayValues();
  var ids = sourceSheet
    .getRange(2, TRACKING_CONFIG.TASK_ID_COLUMN, rowCount, 1)
    .getDisplayValues();
  for (var index = 0; index < rowCount; index += 1) {
    if (!includeBlankRows && !contents[index][0] && !dates[index][0]) continue;
    var taskId = String(ids[index][0] || "").trim();
    if (!taskId) continue;
    if (!result[taskId]) result[taskId] = [];
    result[taskId].push(index + 2);
  }
  return result;
}

function readActiveSourceTasks_(sourceSheet) {
  var result = [];
  var lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) return result;
  var rowCount = lastRow - 1;
  var contents = sourceSheet.getRange(2, 3, rowCount, 1).getDisplayValues();
  var dates = sourceSheet.getRange(2, 10, rowCount, 1).getDisplayValues();
  var ids = sourceSheet
    .getRange(2, TRACKING_CONFIG.TASK_ID_COLUMN, rowCount, 1)
    .getDisplayValues();
  for (var index = 0; index < rowCount; index += 1) {
    var content = normalizeTrackedValue_("C", contents[index][0]);
    var orderDate = normalizeTrackedValue_("J", dates[index][0]);
    var taskId = String(ids[index][0] || "").trim();
    if (!taskId) continue;
    result.push({ row: index + 2, taskId: taskId, content: content, orderDate: orderDate });
  }
  return result;
}

/**
 * Neu nguoi dung sort A:Z ma bo sot cot AA an, noi dung se doi dong con Task ID
 * dung yen. Dua vao cap C/J da luu, ham nay chi sua cac chu trinh hoan vi ro rang;
 * edit thong thuong mot chieu se khong bi coi nham la sort.
 */
function repairTaskIdsAfterDetachedSort_(sourceSheet, stateMap) {
  var lastRow = sourceSheet.getLastRow();
  if (lastRow < 3) return { relinkedIds: 0, repairedCycles: 0, unresolvedRows: [] };
  var rowCount = lastRow - 1;
  var contents = sourceSheet.getRange(2, 3, rowCount, 1).getDisplayValues();
  var dates = sourceSheet.getRange(2, 10, rowCount, 1).getDisplayValues();
  var idRange = sourceSheet.getRange(2, TRACKING_CONFIG.TASK_ID_COLUMN, rowCount, 1);
  var ids = idRange.getDisplayValues();

  var expectedByTask = {};
  Object.keys(stateMap || {}).forEach(function(key) {
    var state = stateMap[key];
    if (!state || (state.column !== "C" && state.column !== "J")) return;
    if (!expectedByTask[state.taskId]) expectedByTask[state.taskId] = { C: "", J: "" };
    expectedByTask[state.taskId][state.column] = normalizeTrackedValue_(state.column, state.currentValue);
  });

  var expectedIdsBySignature = {};
  Object.keys(expectedByTask).forEach(function(taskId) {
    var pair = expectedByTask[taskId];
    var signature = pair.C + "\u001f" + pair.J;
    if (!expectedIdsBySignature[signature]) expectedIdsBySignature[signature] = [];
    expectedIdsBySignature[signature].push(taskId);
  });

  var currentIdCounts = {};
  var currentSignatureCounts = {};
  var currentRows = [];
  var mismatchedRows = [];
  for (var index = 0; index < rowCount; index += 1) {
    var content = normalizeTrackedValue_("C", contents[index][0]);
    var orderDate = normalizeTrackedValue_("J", dates[index][0]);
    var taskId = String(ids[index][0] || "").trim();
    if (!taskId) continue;
    var signature = content + "\u001f" + orderDate;
    currentRows.push({ index: index, taskId: taskId, signature: signature });
    currentIdCounts[taskId] = (currentIdCounts[taskId] || 0) + 1;
    currentSignatureCounts[signature] = (currentSignatureCounts[signature] || 0) + 1;
    var expectedPair = expectedByTask[taskId];
    var belongsToOtherTask = (expectedIdsBySignature[signature] || []).some(function(expectedId) {
      return expectedId !== taskId;
    });
    if (expectedPair && expectedPair.C + "\u001f" + expectedPair.J !== signature && belongsToOtherTask) {
      mismatchedRows.push(index + 2);
    }
  }

  var candidates = {};
  currentRows.forEach(function(current) {
    var expectedIds = expectedIdsBySignature[current.signature] || [];
    if (currentIdCounts[current.taskId] !== 1 || currentSignatureCounts[current.signature] !== 1 || expectedIds.length !== 1) return;
    var targetId = expectedIds[0];
    if (targetId === current.taskId || currentIdCounts[targetId] !== 1) return;
    candidates[current.taskId] = { targetId: targetId, index: current.index };
  });

  var visited = {};
  var relinkedIds = 0;
  var repairedCycles = 0;
  Object.keys(candidates).forEach(function(startId) {
    if (visited[startId]) return;
    var path = [];
    var positions = {};
    var currentId = startId;
    while (candidates[currentId] && !visited[currentId] && positions[currentId] === undefined) {
      positions[currentId] = path.length;
      path.push(currentId);
      currentId = candidates[currentId].targetId;
    }
    path.forEach(function(id) { visited[id] = true; });
    if (currentId !== startId || path.length < 2) return;
    path.forEach(function(id) {
      var candidate = candidates[id];
      ids[candidate.index][0] = candidate.targetId;
      relinkedIds += 1;
    });
    repairedCycles += 1;
  });

  if (relinkedIds > 0) idRange.setValues(ids);
  var unresolvedRows = [];
  if (mismatchedRows.length > 1 && relinkedIds < mismatchedRows.length) {
    var repairedRowMap = {};
    Object.keys(candidates).forEach(function(sourceId) {
      var candidate = candidates[sourceId];
      if (String(ids[candidate.index][0] || "").trim() === candidate.targetId) {
        repairedRowMap[candidate.index + 2] = true;
      }
    });
    unresolvedRows = mismatchedRows.filter(function(row) { return !repairedRowMap[row]; });
  }
  return {
    relinkedIds: relinkedIds,
    repairedCycles: repairedCycles,
    unresolvedRows: unresolvedRows
  };
}

function reconcileSourceTaskIds_(sourceSheet, taskIndexSheet) {
  ensureTaskIdColumn_(sourceSheet);
  var lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) {
    return { changedIds: 0, newTaskIds: 0, duplicateIdsFixed: 0, releasedIds: 0 };
  }

  var rowCount = lastRow - 1;
  var contents = sourceSheet.getRange(2, 3, rowCount, 1).getDisplayValues();
  var dates = sourceSheet.getRange(2, 10, rowCount, 1).getDisplayValues();
  var idRange = sourceSheet.getRange(2, TRACKING_CONFIG.TASK_ID_COLUMN, rowCount, 1);
  var ids = idRange.getDisplayValues();
  var existingIndex = readTaskIndexMap_(taskIndexSheet);
  var locations = {};
  var changedIds = 0;
  var newTaskIds = 0;
  var releasedIds = 0;

  for (var index = 0; index < rowCount; index += 1) {
    var active = Boolean(contents[index][0] || dates[index][0]);
    var taskId = String(ids[index][0] || "").trim();
    if (active && !taskId) {
      taskId = Utilities.getUuid();
      ids[index][0] = taskId;
      changedIds += 1;
      newTaskIds += 1;
    }
    if (!taskId) continue;
    if (!locations[taskId]) locations[taskId] = [];
    locations[taskId].push(index);
  }

  var duplicateIdsFixed = 0;
  Object.keys(locations).forEach(function(taskId) {
    var occurrences = locations[taskId];
    if (occurrences.length <= 1) return;
    var preferredSheetRow = existingIndex[taskId]
      ? Number(existingIndex[taskId].currentRow || existingIndex[taskId].lastActiveRow || 0)
      : 0;
    var preferredIndex = occurrences[0];
    for (var occurrenceIndex = 0; occurrenceIndex < occurrences.length; occurrenceIndex += 1) {
      if (occurrences[occurrenceIndex] + 2 === preferredSheetRow) {
        preferredIndex = occurrences[occurrenceIndex];
        break;
      }
    }
    occurrences.forEach(function(sourceIndex) {
      if (sourceIndex === preferredIndex) return;
      ids[sourceIndex][0] = Utilities.getUuid();
      changedIds += 1;
      newTaskIds += 1;
      duplicateIdsFixed += 1;
    });
  });

  if (changedIds > 0) idRange.setValues(ids);
  return {
    changedIds: changedIds,
    newTaskIds: newTaskIds,
    duplicateIdsFixed: duplicateIdsFixed,
    releasedIds: releasedIds
  };
}

function readLogTaskIds_(logSheet) {
  var result = {};
  var lastRow = logSheet.getLastRow();
  if (lastRow < 2) return result;
  var values = logSheet.getRange(2, 3, lastRow - 1, 1).getDisplayValues();
  values.forEach(function(row) {
    var taskId = String(row[0] || "").trim();
    if (taskId) result[taskId] = true;
  });
  return result;
}

function syncTaskIndex_(sourceSheet, logSheet, taskIndexSheet, sourceLabel) {
  var idStats = reconcileSourceTaskIds_(sourceSheet, taskIndexSheet);
  var locations = readSourceTaskLocations_(sourceSheet, true);
  var previous = readTaskIndexMap_(taskIndexSheet);
  var allTaskIds = readLogTaskIds_(logSheet);
  Object.keys(previous).forEach(function(taskId) { allTaskIds[taskId] = true; });
  Object.keys(locations).forEach(function(taskId) { allTaskIds[taskId] = true; });

  var now = new Date().toISOString();
  var structureBatchId = "structure:" + Utilities.getUuid();
  var knownEventKeys = readEventKeySet_(logSheet);
  var structureLogRows = [];
  var movedTasks = 0;
  var deletedTasks = 0;
  var activeTasks = 0;
  var rows = Object.keys(allTaskIds).sort().map(function(taskId) {
    var currentLocations = locations[taskId] || [];
    var oldState = previous[taskId] || null;
    var currentRow = currentLocations.length === 1 ? currentLocations[0] : 0;
    var status = currentLocations.length === 1
      ? TASK_STATUS_ACTIVE
      : (currentLocations.length > 1 ? "TRÙNG MÃ" : TASK_STATUS_DELETED);
    var lastActiveRow = currentRow || (oldState ? oldState.lastActiveRow : 0);
    var changed = !oldState ||
      oldState.currentRow !== currentRow ||
      oldState.status !== status;
    if (status === TASK_STATUS_ACTIVE) activeTasks += 1;
    if (status === TASK_STATUS_DELETED) deletedTasks += 1;
    if (oldState && oldState.currentRow && currentRow && oldState.currentRow !== currentRow) movedTasks += 1;
    if (oldState && oldState.status === TASK_STATUS_ACTIVE && status === TASK_STATUS_DELETED) {
      var deleteKey = createEventKey_(
        taskId,
        "TASK",
        "DELETE_TASK",
        0,
        oldState.updatedAt,
        TASK_STATUS_DELETED
      );
      if (!knownEventKeys[deleteKey]) {
        structureLogRows.push(createLogEventRow_({
          batchId: structureBatchId,
          taskId: taskId,
          row: oldState.lastActiveRow || oldState.currentRow,
          column: "TASK",
          field: "TASK",
          action: "DELETE_TASK",
          revision: 0,
          oldValue: "DÒNG " + (oldState.lastActiveRow || oldState.currentRow),
          newValue: TASK_STATUS_DELETED,
          editedAt: now,
          source: sourceLabel,
          recordStatus: "RECOVERY",
          eventKey: deleteKey
        }));
        knownEventKeys[deleteKey] = true;
      }
    }
    if (oldState && oldState.status === TASK_STATUS_DELETED && status === TASK_STATUS_ACTIVE) {
      var restoreKey = createEventKey_(
        taskId,
        "TASK",
        "RESTORE_TASK",
        0,
        oldState.updatedAt,
        String(currentRow)
      );
      if (!knownEventKeys[restoreKey]) {
        structureLogRows.push(createLogEventRow_({
          batchId: structureBatchId,
          taskId: taskId,
          row: currentRow,
          column: "TASK",
          field: "TASK",
          action: "RESTORE_TASK",
          revision: 0,
          oldValue: TASK_STATUS_DELETED,
          newValue: "DÒNG " + currentRow,
          editedAt: now,
          source: sourceLabel,
          recordStatus: "RECOVERY",
          eventKey: restoreKey
        }));
        knownEventKeys[restoreKey] = true;
      }
    }
    return [
      taskId,
      currentRow || "",
      status,
      changed ? now : oldState.updatedAt,
      changed ? sourceLabel : oldState.source,
      lastActiveRow || ""
    ];
  });

  appendLogRows_(logSheet, structureLogRows);

  var previousDataRows = Math.max(0, taskIndexSheet.getLastRow() - 1);
  if (rows.length > 0) {
    ensureRowCapacity_(taskIndexSheet, rows.length + 1);
    taskIndexSheet.getRange(2, 1, rows.length, TASK_INDEX_HEADERS.length).setValues(rows);
  }
  if (previousDataRows > rows.length) {
    taskIndexSheet
      .getRange(rows.length + 2, 1, previousDataRows - rows.length, TASK_INDEX_HEADERS.length)
      .clearContent();
  }

  return {
    ok: true,
    activeTasks: activeTasks,
    deletedTasks: deletedTasks,
    movedTasks: movedTasks,
    changedIds: idStats.changedIds,
    newTaskIds: idStats.newTaskIds,
    duplicateIdsFixed: idStats.duplicateIdsFixed,
    releasedIds: idStats.releasedIds,
    structureEvents: structureLogRows.length
  };
}

function reconcileTracking_(sourceSheet, logSheet, stateSheet, taskIndexSheet, sourceLabel) {
  try {
    return reconcileTrackingUnsafe_(sourceSheet, logSheet, stateSheet, taskIndexSheet, sourceLabel);
  } catch (error) {
    if (getTrackingHealth_().state !== "ERROR") {
      setTrackingHealth_("ERROR", "RECONCILE_FAILED", []);
    }
    throw error;
  }
}

function reconcileTrackingUnsafe_(sourceSheet, logSheet, stateSheet, taskIndexSheet, sourceLabel) {
  var stateMap = readStateMap_(stateSheet);
  var sortRepair = repairTaskIdsAfterDetachedSort_(sourceSheet, stateMap);
  if (sortRepair.unresolvedRows && sortRepair.unresolvedRows.length > 0) {
    setTrackingHealth_("ERROR", "AMBIGUOUS_TASK_ID_MAPPING", sortRepair.unresolvedRows);
    throw new Error(
      "Phat hien nhieu dong co dau hieu sort tach cot AA nhung khong the gan lai an toan: " +
      sortRepair.unresolvedRows.join(", ") + ". Dung doi soat de admin kiem tra."
    );
  }
  var indexResult = syncTaskIndex_(sourceSheet, logSheet, taskIndexSheet, sourceLabel);
  var tasks = readActiveSourceTasks_(sourceSheet);
  var knownEventKeys = readEventKeySet_(logSheet);
  var logRows = [];
  var stateDirty = false;
  var now = new Date().toISOString();
  var batchId = "reconcile:" + Utilities.getUuid();

  tasks.forEach(function(task) {
    var fields = [
      { column: "C", field: "NỘI DUNG ORDER", value: task.content },
      { column: "J", field: "NGÀY ORDER", value: task.orderDate }
    ];
    fields.forEach(function(fieldInfo) {
      var stateKey = task.taskId + "|" + fieldInfo.column;
      var state = stateMap[stateKey] || null;
      var oldValue = state ? String(state.currentValue || "") : "";
      var newValue = String(fieldInfo.value || "");
      var action = state
        ? determineAction_(oldValue, newValue, state.hasEverValue)
        : (newValue ? "BASELINE" : "");
      var revision = state ? state.revision : 0;
      if (action === "EDIT" || action === "CLEAR") revision += 1;

      if (action) {
        var eventKey = createEventKey_(task.taskId, fieldInfo.column, action, revision, oldValue, newValue);
        if (!knownEventKeys[eventKey]) {
          logRows.push(createLogEventRow_({
            batchId: batchId,
            taskId: task.taskId,
            row: task.row,
            column: fieldInfo.column,
            field: fieldInfo.field,
            action: action,
            revision: revision,
            oldValue: oldValue,
            newValue: newValue,
            editedAt: now,
            source: sourceLabel,
            recordStatus: "RECOVERY",
            eventKey: eventKey
          }));
          knownEventKeys[eventKey] = true;
        }
        // Event co the da ton tai do retry/setup truoc, nhung State van phai
        // tien len gia tri hien tai de lan doi soat sau khong lap lai cung recovery.
      }

      if (!state || oldValue !== newValue) {
        upsertState_(stateSheet, stateMap, {
          key: stateKey,
          taskId: task.taskId,
          column: fieldInfo.column,
          currentValue: newValue,
          revision: revision,
          hasEverValue: state ? (state.hasEverValue || Boolean(newValue)) : Boolean(newValue),
          updatedAt: now
        });
        stateDirty = true;
      }
    });
  });

  appendLogRows_(logSheet, logRows);
  if (stateDirty) writeStateMap_(stateSheet, stateMap);
  setTrackingHealth_("OK", "", []);
  indexResult.recoveredEvents = logRows.length;
  indexResult.relinkedIds = sortRepair.relinkedIds;
  indexResult.repairedSortCycles = sortRepair.repairedCycles;
  return indexResult;
}

function setTrackingHealth_(state, code, rows) {
  PropertiesService.getScriptProperties().setProperties({
    TRACKING_HEALTH_STATE: String(state || "UNKNOWN"),
    TRACKING_HEALTH_CODE: String(code || ""),
    TRACKING_HEALTH_ROWS: (rows || []).join(","),
    TRACKING_HEALTH_AT: new Date().toISOString()
  });
}

function getTrackingHealth_() {
  var properties = PropertiesService.getScriptProperties();
  var rows = String(properties.getProperty("TRACKING_HEALTH_ROWS") || "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  return {
    state: properties.getProperty("TRACKING_HEALTH_STATE") || "UNKNOWN",
    code: properties.getProperty("TRACKING_HEALTH_CODE") || "",
    rows: rows,
    updatedAt: properties.getProperty("TRACKING_HEALTH_AT") || null
  };
}

function getSheetById_(book, sheetId) {
  var sheets = book.getSheets();
  for (var index = 0; index < sheets.length; index += 1) {
    if (sheets[index].getSheetId() === Number(sheetId)) return sheets[index];
  }
  throw new Error("Khong tim thay tab nguon gid=" + sheetId);
}

function ensureEditTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === "onTrackedEdit";
  });
  if (!exists) {
    ScriptApp.newTrigger("onTrackedEdit")
      .forSpreadsheet(TRACKING_CONFIG.SOURCE_SPREADSHEET_ID)
      .onEdit()
      .create();
  }
}

function ensureStructureTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === "onTrackedStructureChange";
  });
  if (!exists) {
    ScriptApp.newTrigger("onTrackedStructureChange")
      .forSpreadsheet(TRACKING_CONFIG.SOURCE_SPREADSHEET_ID)
      .onChange()
      .create();
  }
}

function ensurePeriodicTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === "onTrackedPeriodicReconcile";
  });
  if (!exists) {
    ScriptApp.newTrigger("onTrackedPeriodicReconcile")
      .timeBased()
      .everyMinutes(5)
      .create();
  }
}

function createToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
