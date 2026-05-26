import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID = process.env.SHEET_ID || "1QQ-FGthecJ9bl-XlwDU17ZiD8b47ilJuUs1bSkgpYvM";
const SHEET_GID = process.env.SHEET_GID || "131891982";
const SHEET_NAME = process.env.SHEET_NAME || "2026_Design_Team";
const TZ = process.env.TZ || "Asia/Ho_Chi_Minh";
const SHEET_MAX_COLUMN = process.env.SHEET_MAX_COLUMN || "Z";
const FORCE_FULL_SNAPSHOT = process.env.FORCE_FULL_SNAPSHOT === "1";

// Exclusion setup for known outlier rows.
const EXCLUDED_ROWS_BY_PERSON = {
  KHANG: new Set([128])
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const snapshotPath = path.resolve(__dirname, "..", "data", "snapshot.json");

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeText(value) {
  return (value || "").trim();
}

function normalizePerson(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeChannel(value) {
  const channel = normalizeText(value).toUpperCase();
  if (!channel) return "(trong)";
  return channel.replace(/^SHOPEE\b/, "SHOPPE");
}

function parseQuantity(raw) {
  const source = normalizeText(raw).replace(/,/g, "");
  if (!source) return 0;
  const matches = source.match(/\d+/g);
  if (!matches) return 0;
  if (matches.length > 1 && !/^\d+$/.test(source)) {
    return matches.reduce((sum, v) => sum + Number(v), 0);
  }
  return Number(matches[0]);
}

function normalizeStatus(raw) {
  return normalizeText(raw) || "(trong)";
}

function extractMonth(raw) {
  const text = normalizeText(raw);
  const match = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return "(khong ngay)";
  const month = Number(match[2]);
  const year = Number(match[3]);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function toKeyedCounts(items) {
  return Object.fromEntries(
    [...items.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => [key, value])
  );
}

function applyExclusions(records) {
  return records.filter((record) => {
    const excludedRows = EXCLUDED_ROWS_BY_PERSON[record.person] || new Set();
    return !excludedRows.has(record.row);
  });
}

function exportUrl(range) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export`);
  url.searchParams.set("format", "csv");
  url.searchParams.set("gid", SHEET_GID);
  if (range) url.searchParams.set("range", range);
  return url.toString();
}

async function fetchCsv(range) {
  const response = await fetch(exportUrl(range));
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const csvBytes = await response.arrayBuffer();
  return new TextDecoder("utf-8").decode(csvBytes);
}

async function readPreviousSnapshot() {
  try {
    const raw = await readFile(snapshotPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function currentMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function columnIndex(headers, name) {
  const index = headers.findIndex((header) => normalizeText(header) === name);
  if (index === -1) {
    throw new Error(`Missing required column: ${name}`);
  }
  return index;
}

function recordsFromRows(headers, body, startRowNumber) {
  const colChannel = columnIndex(headers, "K\u00eanh");
  const colDetail = columnIndex(headers, "N\u1ed8I DUNG ORDER");
  const colQty = columnIndex(headers, "S\u1ed0 L\u01af\u1ee2NG");
  const colDate = columnIndex(headers, "NG\u00c0Y ORDER");
  const colCategory = columnIndex(headers, "H\u1ea0NG M\u1ee4C");
  const colStatus = columnIndex(headers, "Tr\u1ea1ng Th\u00e1i");
  const colPerson = columnIndex(headers, "NG\u01af\u1edcI THI\u1ebeT K\u1ebe");

  const records = [];
  for (let index = 0; index < body.length; index += 1) {
    const row = body[index];
    const rowNumber = startRowNumber + index;
    const person = normalizePerson(row[colPerson]);
    if (!person) continue;
    records.push({
      row: rowNumber,
      person,
      channel: normalizeChannel(row[colChannel]),
      detail: normalizeText(row[colDetail]),
      quantity: parseQuantity(row[colQty]),
      month: extractMonth(row[colDate]),
      category: normalizeText(row[colCategory]) || "(trong)",
      status: normalizeStatus(row[colStatus])
    });
  }

  return records;
}

function summarizePerson(records) {
  const totalTasks = records.length;
  const totalQuantity = records.reduce((sum, r) => sum + r.quantity, 0);
  const completed = records.filter((r) => r.status === "Ho\u00e0n th\u00e0nh");
  const inProgress = records.filter((r) => r.status === "\u0110ang th\u1ef1c hi\u1ec7n");
  const canceled = records.filter((r) => r.status === "Cancel");
  const missingQuantity = records.filter((r) => r.quantity === 0);

  const byCategoryQty = new Map();
  const byCategoryTasks = new Map();
  const byChannelQty = new Map();
  const byChannelTasks = new Map();
  const byMonthQty = new Map();
  const byStatusTasks = new Map();

  for (const record of records) {
    byCategoryQty.set(record.category, (byCategoryQty.get(record.category) || 0) + record.quantity);
    byCategoryTasks.set(record.category, (byCategoryTasks.get(record.category) || 0) + 1);
    byChannelQty.set(record.channel, (byChannelQty.get(record.channel) || 0) + record.quantity);
    byChannelTasks.set(record.channel, (byChannelTasks.get(record.channel) || 0) + 1);
    byMonthQty.set(record.month, (byMonthQty.get(record.month) || 0) + record.quantity);
    byStatusTasks.set(record.status, (byStatusTasks.get(record.status) || 0) + 1);
  }

  return {
    tasks: totalTasks,
    quantity: totalQuantity,

    avgQuantityPerTask: totalTasks ? Number((totalQuantity / totalTasks).toFixed(2)) : 0,
    completedTasks: completed.length,
    completedQuantity: completed.reduce((sum, r) => sum + r.quantity, 0),
    inProgressTasks: inProgress.length,
    inProgressQuantity: inProgress.reduce((sum, r) => sum + r.quantity, 0),
    canceledTasks: canceled.length,
    missingQuantityTasks: missingQuantity.length,
    missingQuantityRows: missingQuantity.map((r) => r.row),
    byStatusTasks: toKeyedCounts(byStatusTasks),
    byCategoryQty: toKeyedCounts(byCategoryQty),
    byCategoryTasks: toKeyedCounts(byCategoryTasks),
    byChannelQty: toKeyedCounts(byChannelQty),
    byChannelTasks: toKeyedCounts(byChannelTasks),
    byMonthQty: toKeyedCounts(byMonthQty)
  };
}

function compactRecord(record) {
  return {
    row: record.row,
    person: record.person,
    channel: record.channel,
    category: record.category,
    status: record.status,
    quantity: record.quantity,
    month: record.month,
    detail: record.detail
  };
}

function buildSnapshot(records, updateMode, activeMonth, activeRangeStartRow) {
  const filtered = applyExclusions(records).sort((a, b) => a.row - b.row);
  const people = [...new Set(filtered.map((r) => r.person))].sort((a, b) => a.localeCompare(b));
  const byPerson = {};
  for (const person of people) {
    byPerson[person] = summarizePerson(filtered.filter((r) => r.person === person));
  }

  const latestRows = filtered
    .slice()
    .sort((a, b) => b.row - a.row)
    .slice(0, 200)
    .map(compactRecord);

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      timezone: TZ,
      source: {
        sheetId: SHEET_ID,
        sheetName: SHEET_NAME,
        gid: SHEET_GID
      },
      incremental: {
        mode: updateMode,
        activeMonth,
        activeRangeStartRow,
        sheetMaxColumn: SHEET_MAX_COLUMN
      },
      exclusions: Object.fromEntries(
        Object.entries(EXCLUDED_ROWS_BY_PERSON).map(([person, set]) => [person, [...set.values()]])
      ),
      totalRecords: filtered.length
    },
    overview: summarizePerson(filtered),
    byPerson,
    records: filtered.map(compactRecord),
    latestRows
  };
}

async function loadFullRecords() {
  const rows = parseCsv(await fetchCsv());
  const [headers, ...body] = rows;
  if (!headers || headers.length === 0) {
    throw new Error("No headers found in exported sheet.");
  }
  return recordsFromRows(headers, body, 2);
}

async function loadActiveMonthRecords(previousSnapshot, activeMonth) {
  const previousRecords = Array.isArray(previousSnapshot?.records) ? previousSnapshot.records : [];
  const activeRangeStartRow = previousSnapshot?.metadata?.incremental?.activeRangeStartRow;
  const cachedMonth = previousSnapshot?.metadata?.incremental?.activeMonth;

  if (FORCE_FULL_SNAPSHOT || !previousRecords.length || !activeRangeStartRow || cachedMonth !== activeMonth) {
    const records = await loadFullRecords();
    const monthRows = records.filter((record) => record.month === activeMonth).map((record) => record.row);
    return {
      records,
      updateMode: FORCE_FULL_SNAPSHOT ? "full-forced" : "full-bootstrap",
      activeRangeStartRow: monthRows.length ? Math.min(...monthRows) : null
    };
  }

  const headerRows = parseCsv(await fetchCsv(`A1:${SHEET_MAX_COLUMN}1`));
  const headers = headerRows[0];
  if (!headers || headers.length === 0) {
    throw new Error("No headers found in exported sheet.");
  }

  const rangeRows = parseCsv(await fetchCsv(`A${activeRangeStartRow}:${SHEET_MAX_COLUMN}`));
  const refreshedActiveRecords = recordsFromRows(headers, rangeRows, activeRangeStartRow)
    .filter((record) => record.month === activeMonth);
  const records = [
    ...previousRecords.filter((record) => record.month !== activeMonth),
    ...refreshedActiveRecords
  ];

  return {
    records,
    updateMode: "active-month",
    activeRangeStartRow
  };
}

async function main() {
  const activeMonth = currentMonthKey();
  const previousSnapshot = await readPreviousSnapshot();
  const { records, updateMode, activeRangeStartRow } = await loadActiveMonthRecords(previousSnapshot, activeMonth);
  const snapshot = buildSnapshot(records, updateMode, activeMonth, activeRangeStartRow);

  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(`Snapshot updated (${updateMode}): ${snapshotPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
