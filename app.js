const personFilterEl = document.querySelector("#personFilter");
const monthFilterEl = document.querySelector("#monthFilter");
const updatedAtEl = document.querySelector("#updatedAt");
const totalRecordsEl = document.querySelector("#totalRecords");
const weeklyProgressEl = document.querySelector("#weeklyProgress");
const weeklyScopeEl = document.querySelector("#weeklyScope");
const reloadBtn = document.querySelector("#reloadBtn");
const TIME_ZONE = "Asia/Ho_Chi_Minh";
const WEEK_TASK_LIMIT = 8;

let snapshot = null;
let personList = [];
let monthList = [];
let expandedWeeks = new Set();

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
}

function formatDate(iso) {
  if (!iso) return "N/A";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE
  }).format(date);
}

function monthLabel(monthKey) {
  if (!monthKey || monthKey === "(khong ngay)") return "Không ngày";
  const [year, month] = monthKey.split("-");
  return `${month}/${year}`;
}

function entries(obj) {
  return Object.entries(obj || {});
}

function sumObjectValues(obj) {
  return entries(obj).reduce((sum, [, value]) => sum + Number(value || 0), 0);
}

function snapshotRows() {
  return snapshot.records || snapshot.latestRows || [];
}

function statusKey(status) {
  const value = status || "";
  if (value === "Ho\u00e0n th\u00e0nh") return "completed";
  if (value === "\u0110ang th\u1ef1c hi\u1ec7n") return "inProgress";
  if (value.toLowerCase() === "cancel") return "cancel";
  return "pending";
}

function statusLabel(key) {
  return {
    completed: "Ho\u00e0n th\u00e0nh",
    inProgress: "\u0110ang l\u00e0m",
    cancel: "Cancel",
    pending: "Pending"
  }[key] || "Pending";
}

function statusClass(key) {
  return {
    completed: "status-completed",
    inProgress: "status-progress",
    cancel: "status-cancel",
    pending: "status-pending"
  }[key] || "status-pending";
}

function statusSortValue(row) {
  return {
    inProgress: 0,
    pending: 1,
    cancel: 2,
    completed: 3
  }[statusKey(row.status)] ?? 4;
}

function createCell(value, className = "") {
  const td = document.createElement("td");
  td.textContent = value;
  if (className) td.className = className;
  return td;
}

function renderKpis(data) {
  const container = document.querySelector("#kpiGrid");
  container.innerHTML = "";

  const kpis = [
    { title: "Tổng task", value: formatNumber(data.tasks) },
    { title: "Tổng số lượng", value: formatNumber(data.quantity), highlight: true },
    { title: "TB số lượng/task", value: formatNumber(data.avgQuantityPerTask) },
    { title: "Hoàn thành", value: formatNumber(data.completedTasks), hint: `${formatNumber(data.completedQuantity)} SL` },
    { title: "Đang làm", value: formatNumber(data.inProgressTasks), hint: `${formatNumber(data.inProgressQuantity)} SL` },
    { title: "Cancel", value: formatNumber(data.canceledTasks) },
    { title: "Task thiếu số lượng", value: formatNumber(data.missingQuantityTasks) }
  ];

  for (const item of kpis) {
    const card = document.createElement("article");
    card.className = `card kpi ${item.highlight ? "highlight" : ""}`.trim();
    card.innerHTML = `<span class="title">${item.title}</span><span class="value">${item.value}</span><span class="hint">${item.hint || ""}</span>`;
    container.appendChild(card);
  }
}

function personSummaryRows(person, month) {
  const rows = [];
  const allRows = snapshotRows();
  for (const [name, data] of Object.entries(snapshot.byPerson || {})) {
    const monthQty = month === "ALL" ? data.quantity : Number((data.byMonthQty || {})[month] || 0);
    const monthTasks = month === "ALL"
      ? data.tasks
      : allRows.filter((r) => r.person === name && r.month === month).length;
    if (person !== "ALL" && name !== person) continue;
    rows.push({
      name,
      tasks: monthTasks,
      quantity: monthQty,
      avg: monthTasks ? Number((monthQty / monthTasks).toFixed(2)) : 0,
      completed: month === "ALL"
        ? data.completedTasks
        : allRows.filter((r) => r.person === name && r.month === month && r.status === "Hoàn thành").length,
      inProgress: month === "ALL"
        ? data.inProgressTasks
        : allRows.filter((r) => r.person === name && r.month === month && r.status === "Đang thực hiện").length,
      canceled: month === "ALL"
        ? data.canceledTasks
        : allRows.filter((r) => r.person === name && r.month === month && r.status === "Cancel").length
    });
  }
  return rows.sort((a, b) => b.quantity - a.quantity);
}

function renderPersonTable(person, month) {
  const tbody = document.querySelector("#personTable tbody");
  tbody.innerHTML = "";
  for (const row of personSummaryRows(person, month)) {
    const tr = document.createElement("tr");
    tr.appendChild(createCell(row.name));
    tr.appendChild(createCell(formatNumber(row.tasks), "num"));
    tr.appendChild(createCell(formatNumber(row.quantity), "num"));
    tr.appendChild(createCell(formatNumber(row.avg), "num"));
    tr.appendChild(createCell(formatNumber(row.completed), "num"));
    tr.appendChild(createCell(formatNumber(row.inProgress), "num"));
    tr.appendChild(createCell(formatNumber(row.canceled), "num"));
    tbody.appendChild(tr);
  }
}

function aggregateRows(person, month) {
  return snapshotRows().filter((r) => {
    if (person !== "ALL" && r.person !== person) return false;
    if (month !== "ALL" && r.month !== month) return false;
    return true;
  });
}

function renderChannelCategoryTable(channelGroups) {
  const tbody = document.querySelector("#channelCategoryTable tbody");
  tbody.innerHTML = "";
  for (const group of channelGroups) {
    const totalRow = document.createElement("tr");
    totalRow.className = "group-row";
    totalRow.appendChild(createCell(group.channel === "(trong)" ? "Tr\u1ed1ng" : group.channel));
    totalRow.appendChild(createCell("T\u1ed5ng k\u00eanh"));
    totalRow.appendChild(createCell(formatNumber(group.quantity), "num"));
    totalRow.appendChild(createCell(formatNumber(group.tasks), "num"));
    tbody.appendChild(totalRow);

    for (const info of group.categories) {
      const tr = document.createElement("tr");
      tr.className = "child-row";
      tr.appendChild(createCell(""));
      tr.appendChild(createCell(info.category === "(trong)" ? "Tr\u1ed1ng" : info.category));
      tr.appendChild(createCell(formatNumber(info.quantity), "num"));
      tr.appendChild(createCell(formatNumber(info.tasks), "num"));
      tbody.appendChild(tr);
    }
  }
  if (channelGroups.length === 0) {
    const tr = document.createElement("tr");
    const td = createCell("Kh\u00f4ng c\u00f3 d\u1eef li\u1ec7u k\u00eanh + h\u1ea1ng m\u1ee5c");
    td.colSpan = 4;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function renderMonthTable(rows) {
  const monthMap = new Map();
  for (const row of rows) {
    monthMap.set(row.month, (monthMap.get(row.month) || 0) + row.quantity);
  }
  const sorted = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const tbody = document.querySelector("#monthTable tbody");
  tbody.innerHTML = "";
  for (const [month, qty] of sorted) {
    const tr = document.createElement("tr");
    tr.appendChild(createCell(monthLabel(month)));
    tr.appendChild(createCell(formatNumber(qty), "num"));
    tbody.appendChild(tr);
  }
}

function renderTables(person, month) {
  const rows = aggregateRows(person, month);
  renderMonthTable(rows);

  const channelGroups = new Map();

  for (const row of rows) {
    if (!channelGroups.has(row.channel)) {
      channelGroups.set(row.channel, {
        channel: row.channel,
        quantity: 0,
        tasks: 0,
        categories: new Map()
      });
    }

    const group = channelGroups.get(row.channel);
    group.quantity += row.quantity;
    group.tasks += 1;

    if (!group.categories.has(row.category)) {
      group.categories.set(row.category, { category: row.category, quantity: 0, tasks: 0 });
    }
    const category = group.categories.get(row.category);
    category.quantity += row.quantity;
    category.tasks += 1;
  }

  const channelGroupsSorted = [...channelGroups.values()]
    .map((group) => ({
      ...group,
      categories: [...group.categories.values()].sort((a, b) =>
        b.quantity - a.quantity ||
        a.category.localeCompare(b.category)
      )
    }))
    .sort((a, b) =>
      b.quantity - a.quantity ||
      a.channel.localeCompare(b.channel)
    );
  renderChannelCategoryTable(channelGroupsSorted);
}

function weekRangeLabel(week, month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const start = week === 4 ? 22 : (week - 1) * 7 + 1;
  const end = week === 4 ? lastDay : week * 7;
  return `${String(start).padStart(2, "0")}-${String(end).padStart(2, "0")}`;
}

function latestMonth() {
  return monthList[monthList.length - 1] || null;
}

function summarizeWeek(rows) {
  const summary = {
    tasks: rows.length,
    quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
    completed: 0,
    inProgress: 0,
    cancel: 0,
    pending: 0
  };

  for (const row of rows) {
    summary[statusKey(row.status)] += 1;
  }

  return summary;
}

function createMetric(label, value) {
  const item = document.createElement("span");
  item.innerHTML = `<strong>${formatNumber(value)}</strong>${label}`;
  return item;
}

function createStatusBadge(key) {
  const badge = document.createElement("span");
  badge.className = `status-badge ${statusClass(key)}`;
  badge.textContent = statusLabel(key);
  return badge;
}

function createTaskItem(row) {
  const item = document.createElement("article");
  item.className = "week-task";

  const head = document.createElement("div");
  head.className = "week-task-head";
  head.appendChild(createStatusBadge(statusKey(row.status)));

  const detail = document.createElement("p");
  detail.className = "week-task-detail";
  detail.textContent = row.detail || "(Kh\u00f4ng c\u00f3 n\u1ed9i dung)";
  detail.title = row.detail || "";

  const meta = document.createElement("p");
  meta.className = "week-task-meta";
  meta.textContent = `SL: ${formatNumber(row.quantity)} | ${row.person} | D\u00f2ng ${row.row}`;

  item.appendChild(head);
  item.appendChild(detail);
  item.appendChild(meta);
  return item;
}

function renderWeeklyProgress(person, month) {
  const targetMonth = month === "ALL" ? latestMonth() : month;
  weeklyProgressEl.innerHTML = "";

  if (!targetMonth) {
    weeklyScopeEl.textContent = "Ch\u01b0a c\u00f3 d\u1eef li\u1ec7u th\u00e1ng.";
    return;
  }

  weeklyScopeEl.textContent = `\u0110ang xem ${monthLabel(targetMonth)}${person === "ALL" ? " | T\u1ea5t c\u1ea3 nh\u00e2n s\u1ef1" : ` | ${person}`}`;
  const sourceRows = aggregateRows(person, targetMonth)
    .filter((row) => row.weekOfMonth >= 1 && row.weekOfMonth <= 4)
    .sort((a, b) =>
      statusSortValue(a) - statusSortValue(b) ||
      (a.orderDate || "").localeCompare(b.orderDate || "") ||
      b.quantity - a.quantity ||
      a.row - b.row
    );

  for (let week = 1; week <= 4; week += 1) {
    const weekRows = sourceRows.filter((row) => row.weekOfMonth === week);
    const summary = summarizeWeek(weekRows);
    const card = document.createElement("article");
    card.className = "week-card";

    const header = document.createElement("div");
    header.className = "week-card-head";
    header.innerHTML = `<span>Tu\u1ea7n ${week}</span><strong>${weekRangeLabel(week, targetMonth)}</strong>`;

    const metrics = document.createElement("div");
    metrics.className = "week-metrics";
    metrics.appendChild(createMetric("task", summary.tasks));
    metrics.appendChild(createMetric("SL", summary.quantity));
    metrics.appendChild(createMetric("HT", summary.completed));
    metrics.appendChild(createMetric("\u0110ang", summary.inProgress));
    metrics.appendChild(createMetric("Pending", summary.pending));
    metrics.appendChild(createMetric("Cancel", summary.cancel));

    const list = document.createElement("div");
    list.className = "week-task-list";
    const expandKey = `${person}|${targetMonth}|${week}`;
    const expanded = expandedWeeks.has(expandKey);
    const visibleRows = expanded ? weekRows : weekRows.slice(0, WEEK_TASK_LIMIT);

    if (visibleRows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "week-empty";
      empty.textContent = "Kh\u00f4ng c\u00f3 task";
      list.appendChild(empty);
    } else {
      for (const row of visibleRows) {
        list.appendChild(createTaskItem(row));
      }
    }

    card.appendChild(header);
    card.appendChild(metrics);
    card.appendChild(list);

    if (weekRows.length > WEEK_TASK_LIMIT) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "week-toggle";
      toggle.textContent = expanded
        ? "Thu g\u1ecdn"
        : `Xem th\u00eam ${formatNumber(weekRows.length - WEEK_TASK_LIMIT)} task`;
      toggle.addEventListener("click", () => {
        if (expandedWeeks.has(expandKey)) {
          expandedWeeks.delete(expandKey);
        } else {
          expandedWeeks.add(expandKey);
        }
        renderWeeklyProgress(person, month);
      });
      card.appendChild(toggle);
    }

    weeklyProgressEl.appendChild(card);
  }
}

function renderMissingTable(person, month) {
  const tbody = document.querySelector("#missingQtyTable tbody");
  tbody.innerHTML = "";
  const rows = aggregateRows(person, month).filter((r) => r.quantity === 0);
  for (const row of rows.slice(0, 200)) {
    const tr = document.createElement("tr");
    tr.appendChild(createCell(String(row.row), "num"));
    tr.appendChild(createCell(row.person));
    tr.appendChild(createCell(row.status));
    tr.appendChild(createCell(row.channel));
    tr.appendChild(createCell(row.category));
    tr.appendChild(createCell(row.detail.slice(0, 120)));
    tbody.appendChild(tr);
  }
}

function computeScopeKpi(person, month) {
  const rows = aggregateRows(person, month);
  const completedRows = rows.filter((r) => r.status === "Hoàn thành");
  const inProgressRows = rows.filter((r) => r.status === "Đang thực hiện");
  const canceledRows = rows.filter((r) => r.status === "Cancel");
  const quantity = sumObjectValues({ total: rows.reduce((sum, r) => sum + r.quantity, 0) });
  return {
    tasks: rows.length,
    quantity,
    avgQuantityPerTask: rows.length ? Number((quantity / rows.length).toFixed(2)) : 0,
    completedTasks: completedRows.length,
    completedQuantity: completedRows.reduce((sum, r) => sum + r.quantity, 0),
    inProgressTasks: inProgressRows.length,
    inProgressQuantity: inProgressRows.reduce((sum, r) => sum + r.quantity, 0),
    canceledTasks: canceledRows.length,
    missingQuantityTasks: rows.filter((r) => r.quantity === 0).length
  };
}

function render() {
  const person = personFilterEl.value || "ALL";
  const month = monthFilterEl.value || "ALL";
  const kpi = computeScopeKpi(person, month);
  renderKpis(kpi);
  renderPersonTable(person, month);
  renderTables(person, month);
  renderWeeklyProgress(person, month);
  renderMissingTable(person, month);
}

function setFilters() {
  personFilterEl.innerHTML = `<option value="ALL">Tất cả</option>${personList.map((p) => `<option value="${p}">${p}</option>`).join("")}`;
  monthFilterEl.innerHTML = `<option value="ALL">Tất cả</option>${monthList.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("")}`;
}

async function load() {
  const response = await fetch("./data/snapshot.json", { cache: "no-store" });
  snapshot = await response.json();
  personList = Object.keys(snapshot.byPerson || {}).sort((a, b) => a.localeCompare(b));
  monthList = [...new Set(snapshotRows().map((r) => r.month).filter((v) => v && v !== "(khong ngay)"))]
    .sort((a, b) => a.localeCompare(b));

  updatedAtEl.textContent = `Cập nhật: ${formatDate(snapshot.metadata.generatedAt)}`;
  totalRecordsEl.textContent = `Tổng record: ${formatNumber(snapshot.metadata.totalRecords)}`;
  setFilters();
  render();
}

personFilterEl.addEventListener("change", render);
monthFilterEl.addEventListener("change", render);
reloadBtn.addEventListener("click", load);

load().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  updatedAtEl.textContent = "Lỗi nạp dữ liệu";
});
