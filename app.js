const personFilterEl = document.querySelector("#personFilter");
const monthFilterEl = document.querySelector("#monthFilter");
const updatedAtEl = document.querySelector("#updatedAt");
const totalRecordsEl = document.querySelector("#totalRecords");
const weeklyProgressEl = document.querySelector("#weeklyProgress");
const weeklyScopeEl = document.querySelector("#weeklyScope");
const previousOpenScopeEl = document.querySelector("#previousOpenScope");
const previousOpenSummaryEl = document.querySelector("#previousOpenSummary");
const previousOpenTableBodyEl = document.querySelector("#previousOpenTable tbody");
const reloadBtn = document.querySelector("#reloadBtn");
const TIME_ZONE = "Asia/Ho_Chi_Minh";
const WEEK_TASK_INITIAL_LIMIT = 2;
const WEEK_TASK_EXPAND_STEP = 3;
const CHANNEL_ROW_DISPLAY_LIMIT = 5;

// Dinh dang danh sach so dong: gioi han toi da CHANNEL_ROW_DISPLAY_LIMIT dong,
// neu vuot qua them "+N dong khac" de tranh vo layout khi (trong) co qua nhieu dong.
function formatRowList(rows) {
  const uniqueRows = [...new Set(rows)].sort((a, b) => a - b);
  const shown = uniqueRows.slice(0, CHANNEL_ROW_DISPLAY_LIMIT);
  const rest = uniqueRows.length - shown.length;
  const base = `D\u00f2ng ${shown.join(", ")}`;
  return rest > 0 ? `${base} +${rest} dong khac` : base;
}

let snapshot = null;
let personList = [];
let monthList = [];
let weeklyTaskLimits = new Map();

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

function previousMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  let year = Number(parts.find((part) => part.type === "year")?.value);
  let month = Number(parts.find((part) => part.type === "month")?.value) - 1;

  if (month === 0) {
    year -= 1;
    month = 12;
  }

  return `${year}-${String(month).padStart(2, "0")}`;
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

function renderBarChart(containerId, items, unit = "") {
  const container = document.querySelector(containerId);
  if (!container) return;
  container.innerHTML = "";

  if (items.length === 0) return;
  const max = Math.max(1, ...items.map((item) => item.value));

  if (unit) {
    const unitLabel = document.createElement("div");
    unitLabel.className = "bar-chart-unit";
    unitLabel.textContent = `Đơn vị: ${unit}`;
    container.appendChild(unitLabel);
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "bar-row";

    const labelCol = document.createElement("div");
    labelCol.className = "bar-label-col";
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = item.label;
    label.title = item.label;
    labelCol.appendChild(label);
    const hintLines = Array.isArray(item.hint) ? item.hint : (item.hint ? [item.hint] : []);
    for (const line of hintLines) {
      const hint = document.createElement("span");
      hint.className = "bar-hint";
      hint.textContent = line;
      labelCol.appendChild(hint);
    }

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${Math.max(2, Math.round((item.value / max) * 100))}%`;
    track.appendChild(fill);

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = formatNumber(item.value);

    row.appendChild(labelCol);
    row.appendChild(track);
    row.appendChild(value);
    container.appendChild(row);
  }
}

function renderKpis(data) {
  const container = document.querySelector("#kpiGrid");
  container.innerHTML = "";

  const kpis = [
    { title: "Tổng task", value: formatNumber(data.tasks) },
    { title: "Tổng số lượng", value: formatNumber(data.quantity), highlight: true },
    { title: "TB số lượng/task", value: formatNumber(data.avgQuantityPerTask) },
    { title: "Hoàn thành", value: formatNumber(data.completedTasks), hint: `${formatNumber(data.completedQuantity)} Số lượng` },
    { title: "Đang làm", value: formatNumber(data.inProgressTasks), hint: `${formatNumber(data.inProgressQuantity)} Số lượng`, pulse: true },
    { title: "Pending / trống", value: formatNumber(data.pendingTasks) },
    { title: "Cancel", value: formatNumber(data.canceledTasks) },
    { title: "Task thiếu số lượng", value: formatNumber(data.missingQuantityTasks), hint: "Không tính task Cancel" }
  ];

  for (const item of kpis) {
    const card = document.createElement("article");
    card.className = `card kpi ${item.highlight ? "highlight" : ""}`.trim();
    const dotHtml = item.pulse ? `<span class="pulse-dot pulse-dot-dark"></span>` : "";
    card.innerHTML = `<span class="title">${dotHtml}${item.title}</span><span class="value">${item.value}</span><span class="hint">${item.hint || ""}</span>`;
    container.appendChild(card);
  }
}

function personSummaryRows(person, month) {
  const rows = [];
  for (const name of Object.keys(snapshot.byPerson || {})) {
    if (person !== "ALL" && name !== person) continue;
    const effectiveRows = aggregateRows(name, month);
    const monthTasks = effectiveRows.length;
    const monthQty = effectiveRows.reduce((sum, r) => sum + r.quantity, 0);
    rows.push({
      name,
      tasks: monthTasks,
      quantity: monthQty,
      avg: monthTasks ? Number((monthQty / monthTasks).toFixed(2)) : 0,
      completed: effectiveRows.filter((r) => r.status === "Hoàn thành").length,
      inProgress: effectiveRows.filter((r) => r.status === "Đang thực hiện").length,
      canceled: effectiveRows.filter((r) => r.status === "Cancel").length
    });
  }
  return rows.sort((a, b) => b.quantity - a.quantity);
}

function renderPersonTable(person, month) {
  const rows = personSummaryRows(person, month);
  renderBarChart(
    "#personChart",
    rows
      .filter((row) => row.name)
      .map((row) => ({
        label: row.name,
        value: row.quantity,
        hint: [
          `${formatNumber(row.tasks)} task`,
          `${formatNumber(row.completed)} Ho\u00e0n th\u00e0nh`,
          `${formatNumber(row.inProgress)} \u0110ang l\u00e0m`,
          `${formatNumber(row.canceled)} Cancel`
        ]
      })),
    "Số lượng"
  );
}

function getCompletionMonth(r) {
  if (r.completionDate) {
    const parts = r.completionDate.split("-");
    if (parts.length >= 2) {
      return `${parts[0]}-${parts[1]}`;
    }
  }
  return r.month;
}

function currentCalendarMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function currentCalendarWeek() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    day: "numeric"
  }).formatToParts(new Date());
  const day = Number(parts.find((part) => part.type === "day")?.value || 1);
  if (day >= 1 && day <= 7) return 1;
  if (day >= 8 && day <= 14) return 2;
  if (day >= 15 && day <= 21) return 3;
  return 4;
}

function getEffectiveWeek(r, targetMonth) {
  if (r.completionDate && statusKey(r.status) === "completed") {
    const parts = r.completionDate.split("-");
    if (parts.length >= 3 && `${parts[0]}-${parts[1]}` === targetMonth) {
      const day = Number(parts[2]);
      if (day >= 1 && day <= 7) return 1;
      if (day >= 8 && day <= 14) return 2;
      if (day >= 15 && day <= 21) return 3;
      return 4;
    }
  }
  
  if (statusKey(r.status) === "inProgress") {
    const isAssigned = r.person && r.person !== "" && r.person !== "Trống";
    if (isAssigned) {
      const curMonth = currentCalendarMonthKey();
      if (targetMonth === curMonth) {
        return currentCalendarWeek();
      }
    }
  }
  
  return r.weekOfMonth || 1;
}

function getEffectiveStatusAndQty(r, viewingMonth) {
  const currentStatus = statusKey(r.status);
  const compMonth = getCompletionMonth(r);
  
  if (viewingMonth === "ALL") {
    return { status: currentStatus, quantity: r.quantity };
  }
  
  if (currentStatus === "completed" && compMonth > viewingMonth) {
    return { status: "inProgress", quantity: 0 };
  }
  
  return { status: currentStatus, quantity: r.quantity };
}

function getEffectiveRecord(r, month) {
  const eff = getEffectiveStatusAndQty(r, month);
  const mapped = {
    ...r,
    status: eff.status === "completed" ? "Hoàn thành" : (eff.status === "inProgress" ? "Đang thực hiện" : (eff.status === "cancel" ? "Cancel" : "Pending")),
    quantity: eff.quantity,
    originalRecord: r
  };
  
  mapped.weekOfMonth = getEffectiveWeek(r, month);

  const targetMonth = month === "ALL" ? latestMonth() : month;
  mapped.isDebt = !!(targetMonth && r.month && r.month !== "(khong ngay)" && r.month < targetMonth);

  // Nhan ngay/thang don gian: hoan thanh thi ghi ngay hoan thanh,
  // dang lam thi ghi ngay order. Dong/thang da co san o dong meta xam ben duoi.
  mapped.customLabel = "";
  if (eff.status === "completed" && r.completionDate) {
    const parts = r.completionDate.split("-");
    if (parts.length >= 3) mapped.customLabel = `task ${parts[2]}/${parts[1]}`;
  } else if (eff.status === "inProgress" && r.orderDate) {
    const parts = r.orderDate.split("-");
    if (parts.length >= 3) mapped.customLabel = `task ${parts[2]}/${parts[1]}`;
  }

  return mapped;
}

function isRecordInMonth(r, month) {
  if (month === "ALL") return true;

  const compMonth = getCompletionMonth(r);
  const status = statusKey(r.status);

  if (status === "completed") {
    if (compMonth === month) return true;
    if (compMonth > month && r.month <= month) return true;
    return false;
  }

  if (status === "cancel") {
    return r.month === month;
  }

  const isAssigned = r.person && r.person !== "" && r.person !== "Trống";
  if (isAssigned && status === "inProgress") {
    const curMonth = currentCalendarMonthKey();
    if (month === curMonth) {
      return r.month <= month;
    }
    return r.month === month;
  } else {
    return r.month === month;
  }
}

function aggregateRows(person, month) {
  return snapshotRows()
    .filter((r) => {
      if (person !== "ALL" && r.person !== person) return false;
      if (!isRecordInMonth(r, month)) return false;
      return true;
    })
    .map((r) => getEffectiveRecord(r, month));
}

function renderChannelCategoryGroup(tbody, channelGroups) {
  tbody.innerHTML = "";
  for (const group of channelGroups) {
    const totalRow = document.createElement("tr");
    totalRow.className = "group-row";
    const channelLabel = group.channel === "(trong)" ? `Tr\u1ed1ng (${formatRowList(group.rows)})` : group.channel;
    totalRow.appendChild(createCell(channelLabel));
    totalRow.appendChild(createCell("T\u1ed5ng k\u00eanh"));
    totalRow.appendChild(createCell(formatNumber(group.quantity), "num"));
    totalRow.appendChild(createCell(formatNumber(group.tasks), "num"));
    tbody.appendChild(totalRow);

    for (const info of group.categories) {
      const tr = document.createElement("tr");
      tr.className = "child-row";
      tr.appendChild(createCell(""));
      const categoryLabel = info.category === "(trong)" ? `Tr\u1ed1ng (${formatRowList(info.rows)})` : info.category;
      tr.appendChild(createCell(categoryLabel));
      tr.appendChild(createCell(formatNumber(info.quantity), "num"));
      tr.appendChild(createCell(formatNumber(info.tasks), "num"));
      tbody.appendChild(tr);
    }
  }
  if (channelGroups.length === 0) {
    const tr = document.createElement("tr");
    const td = createCell("Kh\u00f4ng c\u00f3 d\u1eef li\u1ec7u");
    td.colSpan = 4;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function renderChannelCategoryTable(channelGroups) {
  const tbodyA = document.querySelector("#channelCategoryTableA tbody");
  const tbodyB = document.querySelector("#channelCategoryTableB tbody");
  if (!tbodyA || !tbodyB) return;

  // Chia 2 cot theo kieu greedy: kenh nao dang duyet se vao cot dang it dong hon,
  // giup 2 cot can bang chieu cao thay vi chia deu theo so luong kenh.
  const colA = [];
  const colB = [];
  let rowsA = 0;
  let rowsB = 0;
  for (const group of channelGroups) {
    const rowCount = 1 + group.categories.length;
    if (rowsA <= rowsB) {
      colA.push(group);
      rowsA += rowCount;
    } else {
      colB.push(group);
      rowsB += rowCount;
    }
  }

  renderChannelCategoryGroup(tbodyA, colA);
  renderChannelCategoryGroup(tbodyB, colB);
}

function renderMonthTable(rows, month) {
  if (month === "ALL") {
    const monthMap = new Map();
    for (const row of rows) {
      monthMap.set(row.month, (monthMap.get(row.month) || 0) + row.quantity);
    }
    const sorted = [...monthMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    renderBarChart("#monthChart", sorted.map(([m, qty]) => ({ label: monthLabel(m), value: qty })), "Số lượng");
    return;
  }

  // Khi loc 1 thang cu the: tach ro SL moi phat sinh trong thang nay
  // voi SL cua task no dong tu cac thang truoc, tranh xoe nhieu thang gay roi.
  const newRows = rows.filter((row) => row.month === month);
  const debtRows = rows.filter((row) => row.month !== month);
  const newQty = newRows.reduce((sum, row) => sum + row.quantity, 0);
  const debtQty = debtRows.reduce((sum, row) => sum + row.quantity, 0);

  renderBarChart(
    "#monthChart",
    [
      { label: `Mới ${monthLabel(month)}`, value: newQty },
      { label: "Nợ tháng trước", value: debtQty, hint: `${debtRows.length} task` }
    ],
    "Số lượng"
  );
}

function renderTables(person, month) {
  const rows = aggregateRows(person, month);
  renderMonthTable(rows, month);

  const channelGroups = new Map();

  const isVideoCategory = (cat) => {
    const c = (cat || "").trim().toUpperCase();
    return c === "VIDEO" || c === "VIDEO AI";
  };

  for (const row of rows) {
    if (!channelGroups.has(row.channel)) {
      channelGroups.set(row.channel, {
        channel: row.channel,
        quantity: 0,
        tasks: 0,
        categories: new Map(),
        rows: []
      });
    }

    const group = channelGroups.get(row.channel);
    group.quantity += row.quantity;
    group.tasks += 1;
    group.rows.push(row.row);

    const qtyHinh = row.qtyHinh !== undefined ? row.qtyHinh : (isVideoCategory(row.category) ? 0 : row.quantity);
    const qtyVideo = row.qtyVideo !== undefined ? row.qtyVideo : (isVideoCategory(row.category) ? row.quantity : 0);

    if (qtyHinh > 0) {
      const imageCat = isVideoCategory(row.category) ? "HÌNH ẢNH" : row.category;
      if (!group.categories.has(imageCat)) {
        group.categories.set(imageCat, { category: imageCat, quantity: 0, tasks: 0, rows: [] });
      }
      const categoryObj = group.categories.get(imageCat);
      categoryObj.quantity += qtyHinh;
      if (imageCat === row.category) {
        categoryObj.tasks += 1;
        categoryObj.rows.push(row.row);
      }
    }

    if (qtyVideo > 0) {
      const videoCat = row.category === "VIDEO AI" ? "VIDEO AI" : "VIDEO";
      if (!group.categories.has(videoCat)) {
        group.categories.set(videoCat, { category: videoCat, quantity: 0, tasks: 0, rows: [] });
      }
      const categoryObj = group.categories.get(videoCat);
      categoryObj.quantity += qtyVideo;
      if (videoCat === row.category) {
        categoryObj.tasks += 1;
        categoryObj.rows.push(row.row);
      }
    }

    if (qtyHinh === 0 && qtyVideo === 0) {
      if (!group.categories.has(row.category)) {
        group.categories.set(row.category, { category: row.category, quantity: 0, tasks: 0, rows: [] });
      }
      const categoryObj = group.categories.get(row.category);
      categoryObj.tasks += 1;
      categoryObj.rows.push(row.row);
    }
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
  if (key === "inProgress") {
    const dot = document.createElement("span");
    dot.className = "pulse-dot pulse-dot-dark";
    badge.appendChild(dot);
  }
  badge.appendChild(document.createTextNode(statusLabel(key)));
  return badge;
}

function createTaskItem(row) {
  const item = document.createElement("article");
  item.className = "week-task";

  const head = document.createElement("div");
  head.className = "week-task-head";

  const badgesGroup = document.createElement("div");
  badgesGroup.className = "week-task-badges";
  badgesGroup.appendChild(createStatusBadge(statusKey(row.status)));

  if (row.isDebt) {
    const debtBadge = document.createElement("span");
    debtBadge.className = "task-debt-badge";
    debtBadge.innerHTML = "\u23f3 N\u1ee3";
    badgesGroup.appendChild(debtBadge);
  }
  head.appendChild(badgesGroup);

  if (row.customLabel) {
    const isCompleted = statusKey(row.status) === "completed";
    const labelSpan = document.createElement("span");
    labelSpan.className = `task-delay-label ${isCompleted ? "task-delay-completed" : "task-delay-progress"}`;
    labelSpan.textContent = row.customLabel;
    head.appendChild(labelSpan);
  }

  const detail = document.createElement("p");
  detail.className = "week-task-detail";
  detail.textContent = row.detail || "(Kh\u00f4ng c\u00f3 n\u1ed9i dung)";
  detail.title = row.detail || "";

  const meta = document.createElement("p");
  meta.className = "week-task-meta";
  meta.textContent = `S\u1ed1 l\u01b0\u1ee3ng: ${formatNumber(row.quantity)} | ${row.person || "Tr\u1ed1ng"} | D\u00f2ng ${row.row}`;

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
    metrics.appendChild(createMetric("Số lượng", summary.quantity));
    metrics.appendChild(createMetric("Ho\u00e0n th\u00e0nh", summary.completed));
    metrics.appendChild(createMetric("\u0110ang l\u00e0m", summary.inProgress));
    metrics.appendChild(createMetric("Pending", summary.pending));
    metrics.appendChild(createMetric("Cancel", summary.cancel));

    const list = document.createElement("div");
    list.className = "week-task-list";
    const expandKey = `${person}|${targetMonth}|${week}`;
    const currentLimit = weeklyTaskLimits.get(expandKey) || WEEK_TASK_INITIAL_LIMIT;
    const visibleRows = weekRows.slice(0, currentLimit);

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

    if (weekRows.length > WEEK_TASK_INITIAL_LIMIT) {
      const btnGroup = document.createElement("div");
      btnGroup.className = "week-btn-group";

      if (currentLimit < weekRows.length) {
        const remaining = weekRows.length - currentLimit;
        const expandStep = Math.min(WEEK_TASK_EXPAND_STEP, remaining);
        const expandBtn = document.createElement("button");
        expandBtn.type = "button";
        expandBtn.textContent = `Xem th\u00eam ${expandStep} task (c\u00f2n ${remaining})`;
        expandBtn.addEventListener("click", () => {
          weeklyTaskLimits.set(expandKey, currentLimit + WEEK_TASK_EXPAND_STEP);
          renderWeeklyProgress(person, month);
        });
        btnGroup.appendChild(expandBtn);
      }

      if (currentLimit > WEEK_TASK_INITIAL_LIMIT) {
        const collapseBtn = document.createElement("button");
        collapseBtn.type = "button";
        collapseBtn.textContent = "Thu g\u1ecdn";
        collapseBtn.addEventListener("click", () => {
          weeklyTaskLimits.set(expandKey, WEEK_TASK_INITIAL_LIMIT);
          renderWeeklyProgress(person, month);
        });
        btnGroup.appendChild(collapseBtn);
      }

      card.appendChild(btnGroup);
    }

    weeklyProgressEl.appendChild(card);
  }
}

function renderPreviousMonthOpenTasks(person) {
  const targetMonth = previousMonthKey();
  const rows = aggregateRows(person, targetMonth)
    .filter((row) => {
      const realStatus = row.originalRecord ? statusKey(row.originalRecord.status) : statusKey(row.status);
      return realStatus !== "completed" && realStatus !== "cancel";
    })
    .sort((a, b) =>
      statusSortValue(a) - statusSortValue(b) ||
      (a.orderDate || "").localeCompare(b.orderDate || "") ||
      a.person.localeCompare(b.person) ||
      a.row - b.row
    );
  const summary = summarizeWeek(rows);

  previousOpenScopeEl.textContent = `\u0110ang xem ${monthLabel(targetMonth)}${person === "ALL" ? " | T\u1ea5t c\u1ea3 nh\u00e2n s\u1ef1" : ` | ${person}`}`;
  previousOpenSummaryEl.innerHTML = "";
  previousOpenSummaryEl.appendChild(createMetric("task ch\u01b0a xong", summary.tasks));
  previousOpenSummaryEl.appendChild(createMetric("Số lượng", summary.quantity));
  previousOpenSummaryEl.appendChild(createMetric("\u0110ang l\u00e0m", summary.inProgress));
  previousOpenSummaryEl.appendChild(createMetric("Pending", summary.pending));
  previousOpenSummaryEl.appendChild(createMetric("Cancel", summary.cancel));

  previousOpenTableBodyEl.innerHTML = "";
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = createCell(`Kh\u00f4ng c\u00f3 task ch\u01b0a ho\u00e0n th\u00e0nh trong ${monthLabel(targetMonth)}.`);
    td.colSpan = 7;
    tr.appendChild(td);
    previousOpenTableBodyEl.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    const statusCell = document.createElement("td");
    statusCell.appendChild(createStatusBadge(statusKey(row.status)));
    tr.appendChild(statusCell);
    tr.appendChild(createCell(row.detail || "(Kh\u00f4ng c\u00f3 n\u1ed9i dung)", "task-detail-cell"));
    tr.appendChild(createCell(row.person || "Tr\u1ed1ng"));
    tr.appendChild(createCell(row.channel === "(trong)" ? "Tr\u1ed1ng" : row.channel));
    tr.appendChild(createCell(row.category === "(trong)" ? "Tr\u1ed1ng" : row.category));
    tr.appendChild(createCell(formatNumber(row.quantity), "num"));
    tr.appendChild(createCell(String(row.row), "num"));
    previousOpenTableBodyEl.appendChild(tr);
  }
}

function renderMissingTable(person, month) {
  const tbody = document.querySelector("#missingQtyTable tbody");
  tbody.innerHTML = "";
  const rows = aggregateRows(person, month).filter((r) => r.quantity === 0 && r.status !== "Cancel");
  for (const row of rows.slice(0, 200)) {
    const tr = document.createElement("tr");
    tr.appendChild(createCell(String(row.row), "num"));
    tr.appendChild(createCell(row.person || "Tr\u1ed1ng"));
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
  const pendingRows = rows.filter((r) => r.status === "Pending");
  const quantity = rows.reduce((sum, r) => sum + r.quantity, 0);
  return {
    tasks: rows.length,
    quantity,
    avgQuantityPerTask: rows.length ? Number((quantity / rows.length).toFixed(2)) : 0,
    completedTasks: completedRows.length,
    completedQuantity: completedRows.reduce((sum, r) => sum + r.quantity, 0),
    inProgressTasks: inProgressRows.length,
    inProgressQuantity: inProgressRows.reduce((sum, r) => sum + r.quantity, 0),
    canceledTasks: canceledRows.length,
    pendingTasks: pendingRows.length,
    missingQuantityTasks: rows.filter((r) => r.quantity === 0 && r.status !== "Cancel").length
  };
}

function render() {
  const person = personFilterEl.value || "ALL";
  const month = monthFilterEl.value || "ALL";
  const kpi = computeScopeKpi(person, month);
  renderKpis(kpi);
  renderPreviousMonthOpenTasks(person);
  renderPersonTable(person, month);
  renderTables(person, month);
  renderWeeklyProgress(person, month);
  renderMissingTable(person, month);
}

function setFilters() {
  personFilterEl.innerHTML = `<option value="ALL">T\u1ea5t c\u1ea3</option>${personList.map((p) => `<option value="${p}">${p || "Tr\u1ed1ng"}</option>`).join("")}`;
  monthFilterEl.innerHTML = `<option value="ALL">Tất cả</option>${monthList.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("")}`;
}

async function load() {
  const response = await fetch("./data/snapshot.json", { cache: "no-store" });
  snapshot = await response.json();
  personList = Object.keys(snapshot.byPerson || {}).filter((p) => p && p !== "").sort((a, b) => a.localeCompare(b));
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
