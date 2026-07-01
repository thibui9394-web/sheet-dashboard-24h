import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID = process.env.SHEET_ID || "1QQ-FGthecJ9bl-XlwDU17ZiD8b47ilJuUs1bSkgpYvM";
const SHEET_GID = process.env.SHEET_GID || "131891982";
const SHEET_NAME = process.env.SHEET_NAME || "2026_Design_Team";
const TZ = process.env.TZ || "Asia/Ho_Chi_Minh";
const SHEET_MAX_COLUMN = process.env.SHEET_MAX_COLUMN || "Z";
const FORCE_FULL_SNAPSHOT = process.env.FORCE_FULL_SNAPSHOT === "1" || process.env.FORCE_FULL_SNAPSHOT === "true";

// Exclusion setup for known outlier rows.
const EXCLUDED_ROWS_BY_PERSON = {
  KHANG: new Set([128])
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const snapshotPath = path.resolve(__dirname, "..", "data", "snapshot.json");

export function parseCsv(input) {
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

export function normalizeText(value) {
  return (value || "").trim();
}

export function normalizePerson(value) {
  return normalizeText(value).toUpperCase();
}

export function normalizeChannel(value) {
  const channel = normalizeText(value).toUpperCase();
  if (!channel) return "(trong)";
  return channel.replace(/^SHOPEE\b/, "SHOPPE");
}

export function parseQuantity(raw) {
  const source = normalizeText(raw).replace(/,/g, "");
  if (!source) return 0;
  const matches = source.match(/\d+/g);
  if (!matches) return 0;
  if (matches.length > 1 && !/^\d+$/.test(source)) {
    return matches.reduce((sum, v) => sum + Number(v), 0);
  }
  return Number(matches[0]);
}

export function normalizeStatus(raw) {
  return normalizeText(raw) || "(trong)";
}

function monthIndex(year, month) {
  return year * 12 + month;
}

function isValidDatePart(day, month) {
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

export function parseOrderDate(raw) {
  const text = normalizeText(raw);
  const match = text.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]);
  let day = first;
  let month = second;
  const active = currentMonthKey().split("-").map(Number);
  const activeMonthIndex = monthIndex(active[0], active[1]);
  const dmyMonthIndex = monthIndex(year, second);
  const swappedLooksValid = isValidDatePart(second, first);

  if (!isValidDatePart(first, second) || (dmyMonthIndex > activeMonthIndex && swappedLooksValid)) {
    day = second;
    month = first;
  }

  if (!isValidDatePart(day, month)) return null;
  return { year, month, day };
}

export function extractMonth(raw) {
  const date = parseOrderDate(raw);
  if (!date) return "(khong ngay)";
  const { year, month } = date;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatOrderDate(raw) {
  const date = parseOrderDate(raw);
  if (!date) return null;
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function weekOfMonth(raw) {
  const date = parseOrderDate(raw);
  if (!date) return null;
  return Math.min(4, Math.ceil(date.day / 7));
}

function toKeyedCounts(items) {
  return Object.fromEntries(
    [...items.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => [key, value])
  );
}

export function applyExclusions(records) {
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

export function findColumnIndex(headers, candidates, required = true) {
  const cleaned = (str) => (str || "").trim().toLowerCase().replace(/[\s\r\n]+/g, " ");
  for (const candidate of candidates) {
    const cleanCand = cleaned(candidate);
    const index = headers.findIndex((h) => cleaned(h) === cleanCand);
    if (index !== -1) return index;
  }
  if (required) {
    throw new Error(`Missing required column matching: ${candidates.join(" or ")}`);
  }
  return -1;
}

// Cac cot bat buoc phai co trong sheet. Neu thieu bat ky cot nao,
// ETL se fail voi thong bao ro rang thay vi parse ra so lieu sai tham lang.
const REQUIRED_COLUMN_GROUPS = [
  { label: "NỘI DUNG ORDER", candidates: ["NỘI DUNG ORDER"] },
  { label: "SL HÌNH / SỐ LƯỢNG", candidates: ["SL HÌNH", "SỐ LƯỢNG"] },
  { label: "NGÀY ORDER", candidates: ["NGÀY ORDER"] },
  { label: "HẠNG MỤC", candidates: ["HẠNG MỤC"] },
  { label: "Trạng Thái", candidates: ["Trạng Thái"] },
  { label: "THỰC HIỆN HÌNH ẢNH / NGƯỜI THIẾT KẾ", candidates: ["THỰC HIỆN HÌNH ẢNH", "NGƯỜI THIẾT KẾ"] }
];

export function validateHeaders(headers) {
  if (!headers || headers.length === 0) {
    throw new Error("Sheet khong co header (dong 1 rong).");
  }
  const missing = [];
  for (const group of REQUIRED_COLUMN_GROUPS) {
    const found = group.candidates.some(
      (candidate) => findColumnIndex(headers, [candidate], false) !== -1
    );
    if (!found) missing.push(group.label);
  }
  if (missing.length > 0) {
    throw new Error(
      `Sheet thieu cac cot bat buoc:\n  - ${missing.join("\n  - ")}\n` +
      `Header hien tai: ${JSON.stringify(headers)}`
    );
  }
}

export function recordsFromRows(headers, body, startRowNumber) {
  let colChannel = findColumnIndex(headers, ["Kênh"], false);
  if (colChannel === -1) colChannel = 0;

  const colDetail = findColumnIndex(headers, ["NỘI DUNG ORDER"]);
  const colQtyHinh = findColumnIndex(headers, ["SL HÌNH", "SỐ LƯỢNG"]);
  const colQtyVideo = findColumnIndex(headers, ["SL VIDEO"], false);
  const colDate = findColumnIndex(headers, ["NGÀY ORDER"]);
  const colCategory = findColumnIndex(headers, ["HẠNG MỤC"]);
  const colStatus = findColumnIndex(headers, ["Trạng Thái"]);
  
  const colPersonHinh = findColumnIndex(headers, ["THỰC HIỆN HÌNH ẢNH", "NGƯỜI THIẾT KẾ"]);
  const colPersonVideo = findColumnIndex(headers, ["THỰC HIỆN VIDEO"], false);

  const records = [];
  const isVideoCategory = (cat) => {
    const c = (cat || "").trim().toUpperCase();
    return c === "VIDEO" || c === "VIDEO AI";
  };

  for (let index = 0; index < body.length; index += 1) {
    const row = body[index];
    const rowNumber = startRowNumber + index;
    
    const status = normalizeStatus(row[colStatus]);
    const isCancel = status.toLowerCase() === "cancel";

    const personHinh = normalizePerson(row[colPersonHinh]);
    const personVideo = colPersonVideo !== -1 ? normalizePerson(row[colPersonVideo]) : "";
    if (!personHinh && !personVideo && !isCancel) continue;

    const qtyHinh = parseQuantity(row[colQtyHinh]);
    const qtyVideo = colQtyVideo !== -1 ? parseQuantity(row[colQtyVideo]) : 0;
    
    const channel = normalizeChannel(row[colChannel]);
    const detail = normalizeText(row[colDetail]);
    const month = extractMonth(row[colDate]);
    const orderDate = formatOrderDate(row[colDate]);
    const weekNum = weekOfMonth(row[colDate]);
    const category = normalizeText(row[colCategory]) || "(trong)";

    const actualPersonHinh = personHinh || personVideo;
    const actualPersonVideo = personVideo || personHinh;

    if (qtyHinh > 0 && qtyVideo > 0 && actualPersonHinh !== actualPersonVideo) {
      // Split into two records
      // 1. Image record
      records.push({
        row: rowNumber,
        person: actualPersonHinh,
        channel,
        detail,
        quantity: qtyHinh,
        qtyHinh,
        qtyVideo: 0,
        month,
        orderDate,
        weekOfMonth: weekNum,
        category: isVideoCategory(category) ? "HÌNH ẢNH" : category,
        status
      });
      // 2. Video record
      records.push({
        row: rowNumber,
        person: actualPersonVideo,
        channel,
        detail,
        quantity: qtyVideo,
        qtyHinh: 0,
        qtyVideo,
        month,
        orderDate,
        weekOfMonth: weekNum,
        category: category === "VIDEO AI" ? "VIDEO AI" : "VIDEO",
        status
      });
    } else {
      // Single record
      const person = personHinh || personVideo;
      records.push({
        row: rowNumber,
        person,
        channel,
        detail,
        quantity: qtyHinh + qtyVideo,
        qtyHinh,
        qtyVideo,
        month,
        orderDate,
        weekOfMonth: weekNum,
        category,
        status
      });
    }
  }

  return records;
}

export function summarizePerson(records) {
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

  const isVideoCategory = (cat) => {
    const c = (cat || "").trim().toUpperCase();
    return c === "VIDEO" || c === "VIDEO AI";
  };

  for (const record of records) {
    const qtyHinh = record.qtyHinh !== undefined ? record.qtyHinh : (isVideoCategory(record.category) ? 0 : record.quantity);
    const qtyVideo = record.qtyVideo !== undefined ? record.qtyVideo : (isVideoCategory(record.category) ? record.quantity : 0);

    if (qtyHinh > 0) {
      const imageCat = isVideoCategory(record.category) ? "HÌNH ẢNH" : record.category;
      byCategoryQty.set(imageCat, (byCategoryQty.get(imageCat) || 0) + qtyHinh);
    }
    if (qtyVideo > 0) {
      const videoCat = record.category === "VIDEO AI" ? "VIDEO AI" : "VIDEO";
      byCategoryQty.set(videoCat, (byCategoryQty.get(videoCat) || 0) + qtyVideo);
    }

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
    qtyHinh: record.qtyHinh,
    qtyVideo: record.qtyVideo,
    month: record.month,
    orderDate: record.orderDate || null,
    weekOfMonth: record.weekOfMonth || null,
    detail: record.detail
  };
}

export function buildSnapshot(records, updateMode, activeMonth, activeRangeStartRow) {
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
  validateHeaders(headers);
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
  validateHeaders(headers);

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
  const activeMonth = process.env.TARGET_MONTH || currentMonthKey();
  const previousSnapshot = await readPreviousSnapshot();
  const { records, updateMode, activeRangeStartRow } = await loadActiveMonthRecords(previousSnapshot, activeMonth);
  const snapshot = buildSnapshot(records, updateMode, activeMonth, activeRangeStartRow);

  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  // eslint-disable-next-line no-console
  const prevTotal = previousSnapshot?.metadata?.totalRecords ?? null;
  const delta = prevTotal === null ? null : snapshot.metadata.totalRecords - prevTotal;
  const deltaText = delta === null ? "(chua co snapshot cu)" : `${delta >= 0 ? "+" : ""}${delta}`;
  console.log(
    `Snapshot updated (${updateMode}): ${snapshotPath}\n` +
    `  - Thang active: ${activeMonth} (range bat dau dong ${activeRangeStartRow ?? "?"})\n` +
    `  - Tong record: ${snapshot.metadata.totalRecords} (truoc: ${prevTotal ?? "?"}, chenh lech ${deltaText})\n` +
    `  - Nhan su: ${Object.keys(snapshot.byPerson).join(", ")}`
  );
}

// Chi chay main() khi file duoc goi truc tiep (node .../update-snapshot.mjs),
// khong chay khi import de test.
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
