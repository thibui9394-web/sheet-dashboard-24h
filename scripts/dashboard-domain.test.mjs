import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveRecordForMonth,
  getCompletionMonth,
  getProductionMonth,
  statusKey
} from "../dashboard-domain.js";

const completedInAugust = {
  row: 100,
  person: "KHANG",
  status: "Hoàn thành",
  quantity: 70,
  month: "2026-06",
  orderDate: "2026-06-25",
  completionDate: "2026-08-05",
  weekOfMonth: 4
};

test("task hoan thanh chi tinh san luong vao thang hoan thanh", () => {
  const options = { currentMonth: "2026-08", currentWeek: 2 };
  const june = deriveRecordForMonth(completedInAugust, "2026-06", options);
  const july = deriveRecordForMonth(completedInAugust, "2026-07", options);
  const august = deriveRecordForMonth(completedInAugust, "2026-08", options);
  const september = deriveRecordForMonth(completedInAugust, "2026-09", options);

  assert.equal(june.trackingOnly, true);
  assert.equal(june.status, "Đang thực hiện");
  assert.equal(june.quantity, 0);

  assert.equal(july.trackingOnly, true);
  assert.equal(july.quantity, 0);

  assert.equal(august.trackingOnly, false);
  assert.equal(august.status, "Hoàn thành");
  assert.equal(august.quantity, 70);
  assert.equal(august.weekOfMonth, 1);
  assert.equal(august.reportMonth, "2026-08");
  assert.equal(august.isDebt, true);

  assert.equal(september, null);
});

test("task dang lam duoc tracking qua cac thang nhung chi tinh san luong o thang hien tai", () => {
  const record = {
    ...completedInAugust,
    status: "Đang thực hiện",
    completionDate: ""
  };
  const options = { currentMonth: "2026-08", currentWeek: 2 };

  const june = deriveRecordForMonth(record, "2026-06", options);
  const july = deriveRecordForMonth(record, "2026-07", options);
  const august = deriveRecordForMonth(record, "2026-08", options);

  assert.equal(june.quantity, 0);
  assert.equal(june.trackingOnly, true);
  assert.equal(july.quantity, 0);
  assert.equal(july.trackingOnly, true);
  assert.equal(august.quantity, 70);
  assert.equal(august.trackingOnly, false);
  assert.equal(august.weekOfMonth, 2);
  assert.equal(august.reportMonth, "2026-08");
});

test("scope ALL chi giu mot record va gan dung thang san luong", () => {
  const completed = deriveRecordForMonth(completedInAugust, "ALL", {
    currentMonth: "2026-08",
    currentWeek: 2
  });

  assert.equal(completed.quantity, 70);
  assert.equal(completed.reportMonth, "2026-08");
  assert.equal(completed.trackingOnly, false);
});

test("pending va cancel khong tinh san luong", () => {
  const base = {
    row: 101,
    quantity: 12,
    month: "2026-07",
    orderDate: "2026-07-10",
    weekOfMonth: 2
  };
  const options = { currentMonth: "2026-08", currentWeek: 2 };

  const pending = deriveRecordForMonth({ ...base, status: "Pending" }, "2026-08", options);
  const cancelAll = deriveRecordForMonth({ ...base, status: "Cancel" }, "ALL", options);

  assert.equal(pending.quantity, 0);
  assert.equal(pending.trackingOnly, false);
  assert.equal(cancelAll.quantity, 0);
});

test("helper trang thai va thang hoan thanh dung mot quy tac", () => {
  assert.equal(statusKey("Hoàn thành"), "completed");
  assert.equal(statusKey("Đang thực hiện"), "inProgress");
  assert.equal(statusKey("Pending"), "pending");
  assert.equal(getCompletionMonth(completedInAugust), "2026-08");
  assert.equal(getProductionMonth(completedInAugust, "2026-07"), "2026-08");
});
