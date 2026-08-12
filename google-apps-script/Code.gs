var TRACKING_CONFIG = {
  SOURCE_SPREADSHEET_ID: "1QQ-FGthecJ9bl-XlwDU17ZiD8b47ilJuUs1bSkgpYvM",
  SOURCE_SHEET_GID: 131891982,
  TASK_ID_COLUMN: 27,
  TASK_ID_HEADER: "_TASK_ID",
  LOG_SHEET_NAME: "Edit_Log",
  STATE_SHEET_NAME: "Tracking_State",
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
  "DÒNG HIỆN TẠI",
  "CỘT",
  "TRƯỜNG DỮ LIỆU",
  "LOẠI THAY ĐỔI",
  "LẦN SỬA",
  "GIÁ TRỊ CŨ",
  "GIÁ TRỊ MỚI",
  "THỜI GIAN SỬA",
  "TÀI KHOẢN SỬA",
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

    var baseline = initializeBaseline_(sourceSheet, logSheet, stateSheet);
    ensureEditTrigger_();
    ensureStructureTrigger_();
    var rowSync = syncCurrentRows_(sourceSheet, logSheet);

    if (!properties.getProperty("API_TOKEN")) {
      properties.setProperty("API_TOKEN", createToken_());
    }
    properties.setProperty("TRACKING_VERSION", "2");
    properties.setProperty("TRACKING_INSTALLED_AT", new Date().toISOString());

    var result = {
      ok: true,
      sourceSheet: sourceSheet.getName(),
      logSpreadsheetId: logBook.getId(),
      logSpreadsheetUrl: logBook.getUrl(),
      initializedTasks: baseline.taskCount,
      baselineEvents: baseline.eventCount,
      syncedLogRows: rowSync.updatedRows,
      apiToken: properties.getProperty("API_TOKEN")
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
    var stateMap = readStateMap_(stateSheet);
    var batchId = Utilities.getUuid();
    var editedAt = new Date().toISOString();
    var editorEmail = getEditorEmail_(e);
    var logRows = [];
    var rowsToRelease = [];

    var firstRow = Math.max(2, e.range.getRow());
    var lastRow = e.range.getLastRow();
    var firstColumn = e.range.getColumn();
    var lastColumn = e.range.getLastColumn();

    for (var row = firstRow; row <= lastRow; row += 1) {
      var taskId = getOrCreateTaskId_(sourceSheet, row);
      for (var column = firstColumn; column <= lastColumn; column += 1) {
        var tracked = TRACKING_CONFIG.TRACKED_COLUMNS[column];
        if (!tracked) continue;

        var newValue = sourceSheet.getRange(row, column).getDisplayValue();
        var stateKey = taskId + "|" + tracked.letter;
        var state = stateMap[stateKey] || null;
        var oldValue = state ? state.currentValue : getSingleCellOldValue_(e, row, column);
        if (String(oldValue) === String(newValue)) continue;

        var hasEverValue = state ? state.hasEverValue : String(oldValue) !== "";
        var action = determineAction_(oldValue, newValue, hasEverValue);
        if (!action) continue;

        var revision = state ? state.revision : 0;
        if (action === "EDIT" || action === "CLEAR") revision += 1;
        var nextHasEverValue = hasEverValue || String(newValue) !== "";

        logRows.push([
          Utilities.getUuid(),
          batchId,
          taskId,
          row,
          tracked.letter,
          tracked.field,
          action,
          revision,
          String(oldValue),
          String(newValue),
          editedAt,
          editorEmail,
          row
        ]);

        upsertState_(stateSheet, stateMap, {
          key: stateKey,
          taskId: taskId,
          column: tracked.letter,
          currentValue: String(newValue),
          revision: revision,
          hasEverValue: nextHasEverValue,
          updatedAt: editedAt
        });
      }

      var currentContent = sourceSheet.getRange(row, 3).getDisplayValue();
      var currentOrderDate = sourceSheet.getRange(row, 10).getDisplayValue();
      if (!currentContent && !currentOrderDate) rowsToRelease.push(row);
    }

    if (logRows.length > 0) {
      ensureRowCapacity_(logSheet, logSheet.getLastRow() + logRows.length);
      logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length, LOG_HEADERS.length).setValues(logRows);
      writeStateMap_(stateSheet, stateMap);
    }
    for (var releaseIndex = 0; releaseIndex < rowsToRelease.length; releaseIndex += 1) {
      sourceSheet.getRange(rowsToRelease[releaseIndex], TRACKING_CONFIG.TASK_ID_COLUMN).clearContent();
    }
  } finally {
    lock.releaseLock();
  }
}

/**
 * Endpoint chi tra du lieu an danh cho GitHub Action.
 * Email nguoi sua khong bao gio roi khoi file log rieng.
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
  var values = logSheet.getDataRange().getDisplayValues();
  var events = [];

  for (var index = 1; index < values.length; index += 1) {
    var row = values[index];
    if (!row[2] || !row[10]) continue;
    events.push({
      eventId: row[0],
      batchId: row[1],
      taskId: row[2],
      row: Number(row[3] || 0),
      eventRow: Number(row[12] || row[3] || 0),
      column: row[4],
      field: row[5],
      action: row[6],
      revision: Number(row[7] || 0),
      oldValue: row[8],
      newValue: row[9],
      editedAt: row[10]
    });
  }

  return jsonResponse_({
    ok: true,
    version: 2,
    generatedAt: new Date().toISOString(),
    events: events
  });
}

function getTrackingStatus() {
  var properties = PropertiesService.getScriptProperties();
  return {
    installedAt: properties.getProperty("TRACKING_INSTALLED_AT"),
    logSpreadsheetId: properties.getProperty("LOG_SPREADSHEET_ID"),
    hasApiToken: Boolean(properties.getProperty("API_TOKEN")),
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
    syncCurrentRows_(sourceSheet, logSheet);
  } finally {
    lock.releaseLock();
  }
}

/** Chay thu cong neu can dong bo ngay cot DONG HIEN TAI trong Sheet Log. */
function syncCurrentRows() {
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
    var result = syncCurrentRows_(sourceSheet, logSheet);
    console.log("ROW_SYNC_RESULT=" + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Tam dung ghi log, khong xoa Task ID hay lich su. Chay setupTracking de bat lai. */
function pauseTracking() {
  var deleted = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "onTrackedEdit" ||
        trigger.getHandlerFunction() === "onTrackedStructureChange") {
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
  headerCell.setValue(TRACKING_CONFIG.TASK_ID_HEADER);
  sheet.hideColumns(column);
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
  var logRows = [];
  var now = new Date().toISOString();
  var changedIds = false;
  var taskCount = 0;

  for (var index = 0; index < rowCount; index += 1) {
    var content = String(contentValues[index][0] || "");
    var orderDate = String(dateValues[index][0] || "");
    if (!content && !orderDate) continue;

    taskCount += 1;
    var taskId = String(idValues[index][0] || "").trim();
    if (!taskId) {
      taskId = Utilities.getUuid();
      idValues[index][0] = taskId;
      changedIds = true;
    }

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
        logRows.push([
          Utilities.getUuid(),
          "setup",
          taskId,
          index + 2,
          fieldInfo.column,
          fieldInfo.field,
          "BASELINE",
          0,
          "",
          fieldInfo.value,
          now,
          "",
          index + 2
        ]);
      }
    }
  }

  if (changedIds) idRange.setValues(idValues);
  writeStateMap_(stateSheet, stateMap);
  if (logRows.length > 0) {
    logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length, LOG_HEADERS.length).setValues(logRows);
  }
  return { taskCount: taskCount, eventCount: logRows.length };
}

function getOrCreateTaskId_(sheet, row) {
  var cell = sheet.getRange(row, TRACKING_CONFIG.TASK_ID_COLUMN);
  var taskId = String(cell.getDisplayValue() || "").trim();
  if (taskId && isDuplicateTaskId_(sheet, row, taskId)) taskId = "";
  if (!taskId) {
    taskId = Utilities.getUuid();
    cell.setValue(taskId);
  }
  return taskId;
}

function isDuplicateTaskId_(sheet, currentRow, taskId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var matches = sheet
    .getRange(2, TRACKING_CONFIG.TASK_ID_COLUMN, lastRow - 1, 1)
    .createTextFinder(taskId)
    .matchEntireCell(true)
    .findAll();
  return matches.some(function(match) { return match.getRow() !== currentRow; });
}

function readStateMap_(stateSheet) {
  var values = stateSheet.getDataRange().getDisplayValues();
  var map = {};
  for (var index = 1; index < values.length; index += 1) {
    var row = values[index];
    if (!row[0]) continue;
    map[row[0]] = {
      rowNumber: index + 1,
      key: row[0],
      taskId: row[1],
      column: row[2],
      currentValue: row[3],
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
    currentValue: state.currentValue,
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
      state.currentValue,
      state.revision,
      state.hasEverValue,
      state.updatedAt
    ];
  });
  stateSheet.getRange(2, 1, rows.length, STATE_HEADERS.length).setValues(rows);
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
  if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 &&
      e.range.getRow() === row && e.range.getColumn() === column) {
    return e.oldValue === undefined ? "" : String(e.oldValue);
  }
  return "";
}

function rangeTouchesTrackedColumn_(range) {
  var first = range.getColumn();
  var last = range.getLastColumn();
  return Object.keys(TRACKING_CONFIG.TRACKED_COLUMNS).some(function(column) {
    var value = Number(column);
    return value >= first && value <= last;
  });
}

function getEditorEmail_(e) {
  try {
    if (e.user && e.user.getEmail()) return e.user.getEmail();
  } catch (ignore) {}
  try {
    return Session.getActiveUser().getEmail() || "";
  } catch (ignore) {
    return "";
  }
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
  var oldHeaderCount = PREVIOUS_LOG_HEADERS.length;
  var oldHeaders = sheet.getRange(1, 1, 1, oldHeaderCount).getDisplayValues()[0];
  var isPreviousVietnamese = oldHeaders.join("|") === PREVIOUS_LOG_HEADERS.join("|");
  var isLegacyEnglish = oldHeaders.join("|") === LEGACY_LOG_HEADERS.join("|");
  if (!isPreviousVietnamese && !isLegacyEnglish) return false;

  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var rowCount = lastRow - 1;
    var currentRows = sheet.getRange(2, 4, rowCount, 1).getDisplayValues();
    sheet.getRange(2, 13, rowCount, 1).setValues(currentRows);
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return true;
}

function syncCurrentRows_(sourceSheet, logSheet) {
  var sourceLastRow = sourceSheet.getLastRow();
  var currentRowByTaskId = {};
  if (sourceLastRow >= 2) {
    var sourceIds = sourceSheet
      .getRange(2, TRACKING_CONFIG.TASK_ID_COLUMN, sourceLastRow - 1, 1)
      .getDisplayValues();
    for (var sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex += 1) {
      var sourceTaskId = String(sourceIds[sourceIndex][0] || "").trim();
      if (sourceTaskId) currentRowByTaskId[sourceTaskId] = sourceIndex + 2;
    }
  }

  var logLastRow = logSheet.getLastRow();
  if (logLastRow < 2) return { ok: true, updatedRows: 0, missingTasks: 0 };

  var logRowCount = logLastRow - 1;
  var logTaskAndRows = logSheet.getRange(2, 3, logRowCount, 2).getDisplayValues();
  var currentRowValues = [];
  var updatedRows = 0;
  var missingTasks = 0;
  for (var logIndex = 0; logIndex < logTaskAndRows.length; logIndex += 1) {
    var logTaskId = String(logTaskAndRows[logIndex][0] || "").trim();
    var previousRow = String(logTaskAndRows[logIndex][1] || "");
    var currentRow = currentRowByTaskId[logTaskId];
    if (!currentRow) {
      currentRowValues.push([previousRow]);
      if (logTaskId) missingTasks += 1;
      continue;
    }
    currentRowValues.push([currentRow]);
    if (String(currentRow) !== previousRow) updatedRows += 1;
  }
  if (updatedRows > 0) {
    logSheet.getRange(2, 4, logRowCount, 1).setValues(currentRowValues);
  }
  return { ok: true, updatedRows: updatedRows, missingTasks: missingTasks };
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

function createToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
