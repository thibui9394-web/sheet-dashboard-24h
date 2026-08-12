export const TIME_ZONE = "Asia/Ho_Chi_Minh";

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/;

export function statusKey(status) {
  const value = (status || "").trim();
  if (value === "Hoàn thành") return "completed";
  if (value === "Đang thực hiện") return "inProgress";
  if (value.toLowerCase() === "cancel") return "cancel";
  return "pending";
}

export function currentCalendarMonthKey(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function defaultDashboardMonth(selectedMonth, date = new Date()) {
  return selectedMonth === "ALL" ? currentCalendarMonthKey(date) : selectedMonth;
}

export function currentCalendarWeek(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    day: "numeric"
  }).formatToParts(date);
  const day = Number(parts.find((part) => part.type === "day")?.value || 1);
  return weekFromDay(day);
}

export function weekFromDay(day) {
  if (day >= 1 && day <= 7) return 1;
  if (day >= 8 && day <= 14) return 2;
  if (day >= 15 && day <= 21) return 3;
  return 4;
}

export function getCompletionMonth(record) {
  if (record.completionDate) {
    const parts = record.completionDate.split("-");
    if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
  }
  return record.month;
}

export function getProductionMonth(record, currentMonth = currentCalendarMonthKey()) {
  const key = statusKey(record.status);
  if (key === "completed") return getCompletionMonth(record);
  if (key === "inProgress") return currentMonth;
  return record.month;
}

function isComparableMonth(month) {
  return MONTH_KEY_PATTERN.test(month || "");
}

function isMonthBetween(month, startMonth, endMonth) {
  return isComparableMonth(month) &&
    isComparableMonth(startMonth) &&
    isComparableMonth(endMonth) &&
    month >= startMonth &&
    month <= endMonth;
}

function statusValue(key) {
  return {
    completed: "Hoàn thành",
    inProgress: "Đang thực hiện",
    cancel: "Cancel",
    pending: "Pending"
  }[key] || "Pending";
}

function completionWeek(record) {
  if (!record.completionDate) return record.weekOfMonth || 1;
  const parts = record.completionDate.split("-");
  if (parts.length < 3) return record.weekOfMonth || 1;
  return weekFromDay(Number(parts[2]));
}

/**
 * Chuyển một record gốc thành record hiệu lực cho scope đang xem.
 *
 * Quy tắc:
 * - Hoàn thành: sản lượng chỉ thuộc tháng hoàn thành.
 * - Đang thực hiện: sản lượng thuộc tháng hiện tại.
 * - Pending/Cancel: không tính sản lượng.
 * - Các tháng trước chỉ giữ dấu task tồn với quantity = 0.
 */
export function deriveRecordForMonth(record, viewingMonth, options = {}) {
  const currentMonth = options.currentMonth || currentCalendarMonthKey();
  const currentWeek = options.currentWeek || currentCalendarWeek();
  const key = statusKey(record.status);
  const orderMonth = record.month;
  const completionMonth = getCompletionMonth(record);
  const productionMonth = getProductionMonth(record, currentMonth);

  let include = viewingMonth === "ALL";
  let trackingOnly = false;
  let effectiveKey = key;
  let quantity = (key === "completed" || key === "inProgress") ? Number(record.quantity || 0) : 0;

  if (viewingMonth !== "ALL") {
    if (key === "completed") {
      if (viewingMonth === completionMonth) {
        include = true;
      } else if (
        isComparableMonth(orderMonth) &&
        isComparableMonth(completionMonth) &&
        viewingMonth >= orderMonth &&
        viewingMonth < completionMonth
      ) {
        include = true;
        trackingOnly = true;
        effectiveKey = "inProgress";
        quantity = 0;
      }
    } else if (key === "inProgress") {
      include = isMonthBetween(viewingMonth, orderMonth, currentMonth) || viewingMonth === orderMonth;
      trackingOnly = include && viewingMonth !== currentMonth;
      quantity = viewingMonth === currentMonth
        ? Number(record.quantity || 0)
        : 0;
    } else if (key === "pending") {
      // Pending cu chi nam trong lich su cac thang truoc va bang task chua xong.
      // Khong mang no vao box tien do cua thang hien tai, tranh hien task o
      // tuan 3/4 chua toi va tranh trung voi bang backlog ben duoi.
      include = viewingMonth === orderMonth || (
        viewingMonth !== currentMonth &&
        isMonthBetween(viewingMonth, orderMonth, currentMonth)
      );
      trackingOnly = include && viewingMonth !== orderMonth;
      quantity = 0;
    } else if (key === "cancel") {
      include = viewingMonth === orderMonth;
      quantity = 0;
    }
  }

  if (!include) return null;

  let weekOfMonth = record.weekOfMonth || 1;
  if (key === "completed" && !trackingOnly && viewingMonth !== "ALL") {
    weekOfMonth = completionWeek(record);
  } else if (key === "inProgress" && viewingMonth === currentMonth) {
    weekOfMonth = currentWeek;
  } else if (trackingOnly && viewingMonth !== orderMonth) {
    weekOfMonth = 4;
  }

  const targetMonth = viewingMonth === "ALL" ? productionMonth : viewingMonth;
  const isDebt = isComparableMonth(orderMonth) &&
    isComparableMonth(targetMonth) &&
    orderMonth < targetMonth;

  let customLabel = "";
  if (effectiveKey === "completed" && record.completionDate) {
    const parts = record.completionDate.split("-");
    if (parts.length >= 3) customLabel = `${parts[2]}/${parts[1]}`;
  } else if (effectiveKey === "inProgress" && record.orderDate) {
    const parts = record.orderDate.split("-");
    if (parts.length >= 3) customLabel = `${parts[2]}/${parts[1]}`;
  }

  return {
    ...record,
    status: statusValue(effectiveKey),
    quantity,
    weekOfMonth,
    reportMonth: productionMonth,
    orderMonth,
    completionMonth,
    trackingOnly,
    isDebt,
    customLabel,
    originalRecord: record
  };
}
