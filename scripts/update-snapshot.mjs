import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHEET_ID = process.env.SHEET_ID || "1QQ-FGthecJ9bl-XlwDU17ZiD8b47ilJuUs1bSkgpYvM";
const SHEET_GID = process.env.SHEET_GID || "131891982";
const SHEET_NAME = process.env.SHEET_NAME || "2026_Design_Team";
const TZ = process.env.TZ || "Asia/Bangkok";
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

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

function summarizePerson(records) {
  const totalTasks = records.length;
  const totalQuantity = records.reduce((sum, r) => sum + r.quantity, 0);
  const completed = records.filter((r) => r.status === "Hoàn thành");
  const inProgress = records.filter((r) => r.status === "Đang thực hiện");
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

async function main() {
  const response = await fetch(EXPORT_URL);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const csvBytes = await response.arrayBuffer();
  const csvText = new TextDecoder("utf-8").decode(csvBytes);
  const rows = parseCsv(csvText);
  const [headers, ...body] = rows;
  if (!headers || headers.length === 0) {
    throw new Error("No headers found in exported sheet.");
  }

  const col = (name) => headers.findIndex((h) => normalizeText(h) === name);
  const colChannel = col("Kênh");
  const colDetail = col("NỘI DUNG ORDER");
  const colQty = col("SỐ LƯỢNG");
  const colDate = col("NGÀY ORDER");
  const colCategory = col("HẠNG MỤC");
  const colStatus = col("Trạng Thái");
  const colPerson = col("NGƯỜI THIẾT KẾ");

  const records = [];
  for (let index = 0; index < body.length; index += 1) {
    const row = body[index];
    const rowNumber = index + 2;
    const person = normalizePerson(row[colPerson]);
    if (!person) continue;
    records.push({
      row: rowNumber,
      person,
      channel: normalizeText(row[colChannel]) || "(trong)",
      detail: normalizeText(row[colDetail]),
      quantity: parseQuantity(row[colQty]),
      month: extractMonth(row[colDate]),
      category: normalizeText(row[colCategory]) || "(trong)",
      status: normalizeStatus(row[colStatus])
    });
  }

  const filtered = applyExclusions(records);
  const people = [...new Set(filtered.map((r) => r.person))].sort((a, b) => a.localeCompare(b));
  const byPerson = {};
  for (const person of people) {
    byPerson[person] = summarizePerson(filtered.filter((r) => r.person === person));
  }

  const latestRows = filtered
    .slice()
    .sort((a, b) => b.row - a.row)
    .slice(0, 200)
    .map((r) => ({
      row: r.row,
      person: r.person,
      channel: r.channel,
      category: r.category,
      status: r.status,
      quantity: r.quantity,
      month: r.month,
      detail: r.detail
    }));

  const snapshot = {
    metadata: {
      generatedAt: new Date().toISOString(),
      timezone: TZ,
      source: {
        sheetId: SHEET_ID,
        sheetName: SHEET_NAME,
        gid: SHEET_GID
      },
      exclusions: Object.fromEntries(
        Object.entries(EXCLUDED_ROWS_BY_PERSON).map(([person, set]) => [person, [...set.values()]])
      ),
      totalRecords: filtered.length
    },
    overview: summarizePerson(filtered),
    byPerson,
    latestRows
  };

  await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  // eslint-disable-next-line no-console
  console.log(`Snapshot updated: ${snapshotPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
