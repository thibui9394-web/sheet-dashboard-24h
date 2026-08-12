import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseCsv,
  parseOrderDate,
  parseQuantity,
  normalizeChannel,
  normalizePerson,
  normalizeStatus,
  normalizeText,
  weekOfMonth,
  extractMonth,
  formatOrderDate,
  applyExclusions,
  findColumnIndex,
  validateHeaders,
  recordsFromRows,
  summarizePerson,
  buildSnapshot
} from "./update-snapshot.mjs";

// ============================================================
// parseCsv
// ============================================================
test("parseCsv: CSV don gian", () => {
  assert.deepEqual(parseCsv("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
});

test("parseCsv: field co dau phay trong quote", () => {
  assert.deepEqual(parseCsv('a,"b,c",d'), [["a", "b,c", "d"]]);
});

test("parseCsv: escape dau nhay kep \"\"", () => {
  assert.deepEqual(parseCsv('a,"""b""",c'), [["a", '"b"', "c"]]);
});

test("parseCsv: newline trong quote", () => {
  assert.deepEqual(parseCsv('a,"b\nc",d'), [["a", "b\nc", "d"]]);
});

test("parseCsv: xu ly \\r\\n", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d"), [["a", "b"], ["c", "d"]]);
});

test("parseCsv: 1 dong khong co newline", () => {
  assert.deepEqual(parseCsv("a,b"), [["a", "b"]]);
});

test("parseCsv: chuoi rong", () => {
  assert.deepEqual(parseCsv(""), []);
});

test("parseCsv: field rong o cuoi", () => {
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});

// ============================================================
// parseQuantity
// ============================================================
test("parseQuantity: so thuong", () => {
  assert.equal(parseQuantity("10"), 10);
});

test("parseQuantity: so co dau phay ngan cach", () => {
  assert.equal(parseQuantity("1,234"), 1234);
});

// Luu y: parseQuantity strip dau phay TRUOC khi match so
// (coi dau phay la separator ngan cach nghin nhu "1,234").
// Vi vay "5,3" -> "53" -> 53, KHONG phai 8.
test("parseQuantity: dau phay duoc strip nhu separator nghin", () => {
  assert.equal(parseQuantity("5,3"), 53);
});

test("parseQuantity: chuoi rong", () => {
  assert.equal(parseQuantity(""), 0);
});

test("parseQuantity: text khong co so", () => {
  assert.equal(parseQuantity("abc"), 0);
});

test("parseQuantity: so kem chu", () => {
  assert.equal(parseQuantity("SL 10 cai"), 10);
});

// ============================================================
// normalizeChannel
// ============================================================
test("normalizeChannel: SHOPEE lowercase -> SHOPPE", () => {
  assert.equal(normalizeChannel("shopee"), "SHOPPE");
});

test("normalizeChannel: SHOPEE hoa -> SHOPPE", () => {
  assert.equal(normalizeChannel("SHOPEE"), "SHOPPE");
});

test("normalizeChannel: SHOPPE giu nguyen", () => {
  assert.equal(normalizeChannel("SHOPPE"), "SHOPPE");
});

test("normalizeChannel: rong -> (trong)", () => {
  assert.equal(normalizeChannel(""), "(trong)");
});

test("normalizeChannel: khoang trang -> (trong)", () => {
  assert.equal(normalizeChannel("   "), "(trong)");
});

test("normalizeChannel: kenh khac giu nguyen hoa", () => {
  assert.equal(normalizeChannel("facebook"), "FACEBOOK");
});

// ============================================================
// normalizePerson / normalizeStatus / normalizeText
// ============================================================
test("normalizePerson: viet hoa", () => {
  assert.equal(normalizePerson("khang"), "KHANG");
});

test("normalizePerson: trim khoang trang", () => {
  assert.equal(normalizePerson("  Nhat Thi  "), "NHAT THI");
});

test("normalizeStatus: rong -> (trong)", () => {
  assert.equal(normalizeStatus(""), "(trong)");
});

test("normalizeStatus: giu nguyen trang thai", () => {
  assert.equal(normalizeStatus("Hoàn thành"), "Hoàn thành");
});

test("normalizeText: null -> rong", () => {
  assert.equal(normalizeText(null), "");
});

// ============================================================
// weekOfMonth
// ============================================================
test("weekOfMonth: ngay 1-7 -> tuan 1", () => {
  assert.equal(weekOfMonth("3/6/2026"), 1);
  assert.equal(weekOfMonth("7/6/2026"), 1);
});

test("weekOfMonth: ngay 8-14 -> tuan 2", () => {
  assert.equal(weekOfMonth("8/6/2026"), 2);
  assert.equal(weekOfMonth("14/6/2026"), 2);
});

test("weekOfMonth: ngay 15-21 -> tuan 3", () => {
  assert.equal(weekOfMonth("15/6/2026"), 3);
  assert.equal(weekOfMonth("21/6/2026"), 3);
});

test("weekOfMonth: ngay 22+ -> tuan 4 (capped)", () => {
  assert.equal(weekOfMonth("22/6/2026"), 4);
  assert.equal(weekOfMonth("30/6/2026"), 4);
});

test("weekOfMonth: ngay khong hop le -> null", () => {
  assert.equal(weekOfMonth("abc"), null);
  assert.equal(weekOfMonth("31/6/2026"), null);
  assert.equal(weekOfMonth("29/2/2025"), null);
  assert.equal(weekOfMonth("29/2/2024"), 4);
});

// ============================================================
// extractMonth / formatOrderDate
// ============================================================
test("extractMonth: ngay dung -> YYYY-MM", () => {
  assert.equal(extractMonth("3/6/2026"), "2026-06");
});

test("extractMonth: rong -> (khong ngay)", () => {
  assert.equal(extractMonth(""), "(khong ngay)");
});

test("formatOrderDate: ngay dung -> YYYY-MM-DD", () => {
  assert.equal(formatOrderDate("3/6/2026"), "2026-06-03");
  assert.equal(formatOrderDate("03/08/2026 14:35"), "2026-08-03");
  assert.equal(formatOrderDate("12/08/2026 18:16"), "2026-08-12");
  assert.equal(formatOrderDate("08/12/2026 18:16"), "2026-12-08");
});

test("formatOrderDate: sai -> null", () => {
  assert.equal(formatOrderDate("abc"), null);
  assert.equal(formatOrderDate("31/06/2026 14:35"), null);
  assert.equal(formatOrderDate("08-03-2026"), null);
});

// ============================================================
// findColumnIndex
// ============================================================
test("findColumnIndex: tim dung cot", () => {
  const headers = ["Kênh", "NỘI DUNG ORDER", "SL HÌNH"];
  assert.equal(findColumnIndex(headers, ["SL HÌNH"]), 2);
});

test("findColumnIndex: nhieu candidate, lay cai dau tien match", () => {
  const headers = ["A", "SỐ LƯỢNG", "B"];
  assert.equal(findColumnIndex(headers, ["SL HÌNH", "SỐ LƯỢNG"]), 1);
});

test("findColumnIndex: khong tim thay + required -> throw", () => {
  const headers = ["A", "B"];
  assert.throws(() => findColumnIndex(headers, ["KHÔNG CÓ"]), /Missing required column/);
});

test("findColumnIndex: khong tim thay + optional -> -1", () => {
  const headers = ["A", "B"];
  assert.equal(findColumnIndex(headers, ["KHÔNG CÓ"], false), -1);
});

// ============================================================
// validateHeaders
// ============================================================
test("validateHeaders: du tat ca cot bat buoc -> khong throw", () => {
  const headers = [
    "Kênh", "NỘI DUNG ORDER", "SL HÌNH", "NGÀY ORDER",
    "HẠNG MỤC", "Trạng Thái", "THỰC HIỆN HÌNH ẢNH"
  ];
  assert.doesNotThrow(() => validateHeaders(headers));
});

test("validateHeaders: dung candidate thu 2 (NGUOI THIET KE)", () => {
  const headers = [
    "Kênh", "NỘI DUNG ORDER", "SL HÌNH", "NGÀY ORDER",
    "HẠNG MỤC", "Trạng Thái", "NGƯỜI THIẾT KẾ"
  ];
  assert.doesNotThrow(() => validateHeaders(headers));
});

test("validateHeaders: thieu cot -> throw voi ten cot thieu", () => {
  const headers = ["Kênh", "NỘI DUNG ORDER", "NGÀY ORDER", "Trạng Thái"];
  assert.throws(
    () => validateHeaders(headers),
    /thieu cac cot bat buoc[\s\S]*SL HÌNH[\s\S]*HẠNG MỤC[\s\S]*THỰC HIỆN HÌNH ẢNH/
  );
});

test("validateHeaders: header rong -> throw", () => {
  assert.throws(() => validateHeaders([]), /khong co header/);
  assert.throws(() => validateHeaders(null), /khong co header/);
});
test("applyExclusions: loai row outlier KHANG 128", () => {
  const records = [
    { row: 127, person: "KHANG", quantity: 5 },
    { row: 128, person: "KHANG", quantity: 1000 },
    { row: 129, person: "KHANG", quantity: 3 }
  ];
  const result = applyExclusions(records);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.row), [127, 129]);
});

test("applyExclusions: row 128 cua nguoi khac van giu", () => {
  const records = [
    { row: 128, person: "ẨN", quantity: 5 },
    { row: 128, person: "KHANG", quantity: 1000 }
  ];
  const result = applyExclusions(records);
  assert.equal(result.length, 1);
  assert.equal(result[0].person, "ẨN");
});

// ============================================================
// recordsFromRows — PHẦN QUAN TRỌNG NHẤT (logic split mới)
// ============================================================
// Layout header chuẩn cho test
const HEADERS = [
  "Kênh",
  "NỘI DUNG ORDER",
  "SL HÌNH",
  "SL VIDEO",
  "NGÀY ORDER",
  "HẠNG MỤC",
  "Trạng Thái",
  "THỰC HIỆN HÌNH ẢNH",
  "THỰC HIỆN VIDEO"
];

function makeRow(channel, detail, qtyHinh, qtyVideo, date, category, status, personHinh, personVideo) {
  return [channel, detail, String(qtyHinh), String(qtyVideo), date, category, status, personHinh, personVideo];
}

test("recordsFromRows: chi hinh -> 1 record", () => {
  const body = [
    makeRow("SHOPEE", "task A", 10, 0, "3/6/2026", "HÌNH ẢNH", "Hoàn thành", "KHANG", "")
  ];
  const records = recordsFromRows(HEADERS, body, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].person, "KHANG");
  assert.equal(records[0].qtyHinh, 10);
  assert.equal(records[0].qtyVideo, 0);
  assert.equal(records[0].quantity, 10);
});

test("recordsFromRows: chi video -> 1 record", () => {
  const body = [
    makeRow("SHOPEE", "task B", 0, 5, "3/6/2026", "VIDEO", "Hoàn thành", "", "NHẬT THI")
  ];
  const records = recordsFromRows(HEADERS, body, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].person, "NHẬT THI");
  assert.equal(records[0].qtyHinh, 0);
  assert.equal(records[0].qtyVideo, 5);
  assert.equal(records[0].quantity, 5);
});

test("recordsFromRows: ca hinh + video CUNG nguoi -> 1 record gop", () => {
  const body = [
    makeRow("SHOPEE", "task C", 8, 3, "3/6/2026", "HÌNH ẢNH", "Hoàn thành", "KHANG", "KHANG")
  ];
  const records = recordsFromRows(HEADERS, body, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].person, "KHANG");
  assert.equal(records[0].quantity, 11);
  assert.equal(records[0].qtyHinh, 8);
  assert.equal(records[0].qtyVideo, 3);
});

test("recordsFromRows: ca hinh + video KHAC nguoi -> 1 record gop 2 ten", () => {
  const body = [
    makeRow("SHOPEE", "task D", 10, 5, "3/6/2026", "HÌNH ẢNH", "Hoàn thành", "KHANG", "NHẬT THI")
  ];
  const records = recordsFromRows(HEADERS, body, 2);
  assert.equal(records.length, 1);

  const rec = records[0];
  assert.equal(rec.person, "KHANG, NHẬT THI");
  assert.equal(rec.personHinh, "KHANG");
  assert.equal(rec.personVideo, "NHẬT THI");
  assert.equal(rec.quantity, 15);
  assert.equal(rec.qtyHinh, 10);
  assert.equal(rec.qtyVideo, 5);
});

test("recordsFromRows: khong co nguoi nao -> van nhan record voi person rong", () => {
  const body = [
    makeRow("SHOPEE", "task E", 10, 0, "3/6/2026", "HÌNH ẢNH", "Hoàn thành", "", "")
  ];
  const records = recordsFromRows(HEADERS, body, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].person, "");
});

test("recordsFromRows: qtyHinh=0, qtyVideo=0 -> 1 record quantity=0", () => {
  const body = [
    makeRow("SHOPEE", "task F", 0, 0, "3/6/2026", "HÌNH ẢNH", "Pending", "KHANG", "")
  ];
  const records = recordsFromRows(HEADERS, body, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].quantity, 0);
  assert.equal(records[0].person, "KHANG");
});

test("recordsFromRows: row number bat dau tu startRowNumber", () => {
  const body = [
    makeRow("SHOPEE", "task", 5, 0, "3/6/2026", "HÌNH ẢNH", "Hoàn thành", "KHANG", "")
  ];
  const records = recordsFromRows(HEADERS, body, 100);
  assert.equal(records[0].row, 100);
});

test("recordsFromRows: doc Task ID ky thuat neu co", () => {
  const headers = [...HEADERS, "_TASK_ID"];
  const body = [[...makeRow("SHOPEE", "task tracked", 1, 0, "3/6/2026", "HINH ANH", "Pending", "KHANG", ""), "task-uuid-1"]];
  const records = recordsFromRows(headers, body, 2);
  assert.equal(records[0].taskId, "task-uuid-1");
});

test("recordsFromRows: 2 nguoi khac nhau VIDEO AI giu nguyen category goc", () => {
  const body = [
    makeRow("SHOPEE", "task G", 10, 5, "3/6/2026", "VIDEO AI", "Hoàn thành", "KHANG", "NHẬT THI")
  ];
  const records = recordsFromRows(HEADERS, body, 2);
  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.person, "KHANG, NHẬT THI");
  assert.equal(rec.category, "VIDEO AI");
  assert.equal(rec.qtyHinh, 10);
  assert.equal(rec.qtyVideo, 5);
});

// ============================================================
// summarizePerson
// ============================================================
test("summarizePerson: tong hop KPI co ban", () => {
  const records = [
    { row: 2, person: "KHANG", channel: "SHOPPE", category: "HÌNH ẢNH", status: "Hoàn thành", quantity: 10, qtyHinh: 10, qtyVideo: 0, month: "2026-06" },
    { row: 3, person: "KHANG", channel: "SHOPPE", category: "VIDEO", status: "Hoàn thành", quantity: 5, qtyHinh: 0, qtyVideo: 5, month: "2026-06" },
    { row: 4, person: "KHANG", channel: "FACEBOOK", category: "HÌNH ẢNH", status: "Đang thực hiện", quantity: 0, qtyHinh: 0, qtyVideo: 0, month: "2026-06" }
  ];
  const summary = summarizePerson(records);
  assert.equal(summary.tasks, 3);
  assert.equal(summary.quantity, 15);
  assert.equal(summary.completedTasks, 2);
  assert.equal(summary.inProgressTasks, 1);
  assert.equal(summary.missingQuantityTasks, 1);
});

test("summarizePerson: tach qty theo category HÌNH ẢNH vs VIDEO", () => {
  const records = [
    { row: 2, person: "KHANG", category: "HÌNH ẢNH", channel: "SHOPPE", status: "Hoàn thành", quantity: 20, qtyHinh: 20, qtyVideo: 0, month: "2026-06" },
    { row: 3, person: "KHANG", category: "VIDEO", channel: "SHOPPE", status: "Hoàn thành", quantity: 8, qtyHinh: 0, qtyVideo: 8, month: "2026-06" }
  ];
  const summary = summarizePerson(records);
  assert.equal(summary.byCategoryQty["HÌNH ẢNH"], 20);
  assert.equal(summary.byCategoryQty["VIDEO"], 8);
});

test("summarizePerson: backward compat record cu khong co qtyHinh/qtyVideo", () => {
  const records = [
    { row: 2, person: "KHANG", category: "HÌNH ẢNH", channel: "SHOPPE", status: "Hoàn thành", quantity: 15, month: "2026-06" },
    { row: 3, person: "KHANG", category: "VIDEO", channel: "SHOPPE", status: "Hoàn thành", quantity: 7, month: "2026-06" }
  ];
  const summary = summarizePerson(records);
  assert.equal(summary.quantity, 22);
  assert.equal(summary.byCategoryQty["HÌNH ẢNH"], 15);
  assert.equal(summary.byCategoryQty["VIDEO"], 7);
});

test("summarizePerson: mang rong", () => {
  const summary = summarizePerson([]);
  assert.equal(summary.tasks, 0);
  assert.equal(summary.quantity, 0);
  assert.equal(summary.avgQuantityPerTask, 0);
});

test("summarizePerson: tong san luong chi gom hoan thanh va dang thuc hien", () => {
  const records = [
    { row: 2, category: "HÌNH ẢNH", channel: "SHOPPE", status: "Hoàn thành", quantity: 10, qtyHinh: 10, qtyVideo: 0, month: "2026-06", completionDate: "2026-07-03" },
    { row: 3, category: "HÌNH ẢNH", channel: "SHOPPE", status: "Đang thực hiện", quantity: 5, qtyHinh: 5, qtyVideo: 0, month: "2026-06" },
    { row: 4, category: "HÌNH ẢNH", channel: "SHOPPE", status: "Pending", quantity: 7, qtyHinh: 7, qtyVideo: 0, month: "2026-07" },
    { row: 5, category: "HÌNH ẢNH", channel: "SHOPPE", status: "Cancel", quantity: 9, qtyHinh: 9, qtyVideo: 0, month: "2026-07" }
  ];

  const summary = summarizePerson(records);
  assert.equal(summary.quantity, 15);
  assert.equal(summary.completedQuantity, 10);
  assert.equal(summary.inProgressQuantity, 5);
  assert.equal(
    Object.values(summary.byMonthQty).reduce((sum, quantity) => sum + quantity, 0),
    15
  );
});

test("recordsFromRows: khong co nguoi thiet ke nhung status la Cancel -> van giu va assign cho (trong)", () => {
  const body = [
    makeRow("SHOPEE", "task Cancelled", 0, 0, "3/6/2026", "HÌNH ẢNH", "Cancel", "", "")
  ];
  const records = recordsFromRows(HEADERS, body, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].person, "");
});

test("recordsFromRows: ho tro parse cot NGAY HOAN THANH", () => {
  const headersWithCompletion = [
    ...HEADERS,
    "NGÀY HOÀN THÀNH"
  ];
  const body = [
    ["SHOPEE", "task completed", "5", "0", "29/06/2026", "KEY VISUAL", "Hoàn thành", "KHANG", "", "01/07/2026"]
  ];
  const records = recordsFromRows(headersWithCompletion, body, 2);
  assert.equal(records.length, 1);
  assert.equal(records[0].completionDate, "2026-07-01");
});

// ============================================================
// buildSnapshot — person-specific KPI for multi-person records
// ============================================================
test("buildSnapshot: multi-person record tinh dung qty cho tung nguoi", () => {
  const records = [
    {
      row: 2, person: "KHANG, NHẬT THI", personHinh: "KHANG", personVideo: "NHẬT THI",
      channel: "SHOPPE", detail: "task D", category: "HÌNH ẢNH", status: "Hoàn thành",
      quantity: 15, qtyHinh: 10, qtyVideo: 5, month: "2026-06",
      orderDate: "2026-06-03", completionDate: "", weekOfMonth: 1
    }
  ];
  const snap = buildSnapshot(records, "test", "2026-06", 2);

  // KHANG should get qtyHinh = 10
  assert.ok(snap.byPerson["KHANG"], "byPerson phai co KHANG");
  assert.equal(snap.byPerson["KHANG"].quantity, 10);
  assert.equal(snap.byPerson["KHANG"].tasks, 1);

  // NHAT THI should get qtyVideo = 5
  assert.ok(snap.byPerson["NHẬT THI"], "byPerson phai co NHAT THI");
  assert.equal(snap.byPerson["NHẬT THI"].quantity, 5);
  assert.equal(snap.byPerson["NHẬT THI"].tasks, 1);

  // Overview should have total = 15
  assert.equal(snap.overview.quantity, 15);
  assert.equal(snap.overview.tasks, 1);
});

test("buildSnapshot: same-person record giu nguyen full qty", () => {
  const records = [
    {
      row: 2, person: "KHANG", personHinh: "KHANG", personVideo: "KHANG",
      channel: "SHOPPE", detail: "task E", category: "HÌNH ẢNH", status: "Hoàn thành",
      quantity: 15, qtyHinh: 10, qtyVideo: 5, month: "2026-06",
      orderDate: "2026-06-03", completionDate: "", weekOfMonth: 1
    }
  ];
  const snap = buildSnapshot(records, "test", "2026-06", 2);
  assert.ok(snap.byPerson["KHANG"]);
  assert.equal(snap.byPerson["KHANG"].quantity, 15);
  assert.equal(snap.byPerson["KHANG"].tasks, 1);
  // Should NOT have a combined entry
  assert.equal(Object.keys(snap.byPerson).length, 1);
});

test("buildSnapshot: gan edit summary va khong public email nguoi sua", () => {
  const records = [{
    row: 10,
    taskId: "task-10",
    person: "KHANG",
    personHinh: "KHANG",
    personVideo: "KHANG",
    channel: "SHOPPE",
    detail: "task tracked",
    category: "HINH ANH",
    status: "Pending",
    quantity: 0,
    qtyHinh: 0,
    qtyVideo: 0,
    month: "2026-08",
    orderDate: "2026-08-03",
    completionDate: "",
    weekOfMonth: 1
  }];
  const events = [{
    eventId: "event-1",
    taskId: "task-10",
    column: "C",
    action: "EDIT",
    revision: 1,
    oldValue: "A",
    newValue: "B",
    editedAt: "2026-08-12T10:00:00.000Z",
    editorEmail: "private@example.com"
  }];

  const snap = buildSnapshot(records, "test", "2026-08", 2, events);
  assert.equal(snap.records[0].editSummary.editCount, 1);
  assert.equal(snap.editHistory["task-10"][0].editorEmail, undefined);
  assert.equal(snap.metadata.editTracking.editedTaskCount, 1);
});
