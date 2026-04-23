const personFilterEl = document.querySelector("#personFilter");
const monthFilterEl = document.querySelector("#monthFilter");
const updatedAtEl = document.querySelector("#updatedAt");
const totalRecordsEl = document.querySelector("#totalRecords");
const reloadBtn = document.querySelector("#reloadBtn");

let snapshot = null;
let personList = [];
let monthList = [];

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
}

function formatDate(iso) {
  if (!iso) return "N/A";
  const date = new Date(iso);
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(date);
}

function monthLabel(monthKey) {
  if (!monthKey || monthKey === "(khong ngay)") return "Khong ngay";
  const [year, month] = monthKey.split("-");
  return `${month}/${year}`;
}

function entries(obj) {
  return Object.entries(obj || {});
}

function sumObjectValues(obj) {
  return entries(obj).reduce((sum, [, value]) => sum + Number(value || 0), 0);
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
    { title: "Tong task", value: formatNumber(data.tasks) },
    { title: "Tong so luong", value: formatNumber(data.quantity), highlight: true },
    { title: "TB so luong/task", value: formatNumber(data.avgQuantityPerTask) },
    { title: "Hoan thanh", value: formatNumber(data.completedTasks), hint: `${formatNumber(data.completedQuantity)} SL` },
    { title: "Dang lam", value: formatNumber(data.inProgressTasks), hint: `${formatNumber(data.inProgressQuantity)} SL` },
    { title: "Cancel", value: formatNumber(data.canceledTasks) },
    { title: "Task thieu so luong", value: formatNumber(data.missingQuantityTasks) }
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
  for (const [name, data] of Object.entries(snapshot.byPerson || {})) {
    const monthQty = month === "ALL" ? data.quantity : Number((data.byMonthQty || {})[month] || 0);
    const monthTasks = month === "ALL"
      ? data.tasks
      : snapshot.latestRows.filter((r) => r.person === name && r.month === month).length;
    if (person !== "ALL" && name !== person) continue;
    rows.push({
      name,
      tasks: monthTasks,
      quantity: monthQty,
      avg: monthTasks ? Number((monthQty / monthTasks).toFixed(2)) : 0,
      completed: month === "ALL"
        ? data.completedTasks
        : snapshot.latestRows.filter((r) => r.person === name && r.month === month && r.status === "Hoàn thành").length,
      inProgress: month === "ALL"
        ? data.inProgressTasks
        : snapshot.latestRows.filter((r) => r.person === name && r.month === month && r.status === "Đang thực hiện").length,
      canceled: month === "ALL"
        ? data.canceledTasks
        : snapshot.latestRows.filter((r) => r.person === name && r.month === month && r.status === "Cancel").length
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
  return snapshot.latestRows.filter((r) => {
    if (person !== "ALL" && r.person !== person) return false;
    if (month !== "ALL" && r.month !== month) return false;
    return true;
  });
}

function renderSimpleTable(targetId, sourceMap, keyLabel) {
  const tbody = document.querySelector(`${targetId} tbody`);
  tbody.innerHTML = "";
  for (const [key, info] of sourceMap) {
    const tr = document.createElement("tr");
    tr.appendChild(createCell(key === "(trong)" ? "Trong" : key));
    tr.appendChild(createCell(formatNumber(info.quantity), "num"));
    tr.appendChild(createCell(formatNumber(info.tasks), "num"));
    tbody.appendChild(tr);
  }
  if (sourceMap.length === 0) {
    const tr = document.createElement("tr");
    const td = createCell(`Khong co du lieu ${keyLabel}`);
    td.colSpan = 3;
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

  const category = new Map();
  const channel = new Map();

  for (const row of rows) {
    if (!category.has(row.category)) category.set(row.category, { quantity: 0, tasks: 0 });
    if (!channel.has(row.channel)) channel.set(row.channel, { quantity: 0, tasks: 0 });
    category.get(row.category).quantity += row.quantity;
    category.get(row.category).tasks += 1;
    channel.get(row.channel).quantity += row.quantity;
    channel.get(row.channel).tasks += 1;
  }

  const categorySorted = [...category.entries()].sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 12);
  const channelSorted = [...channel.entries()].sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 12);
  renderSimpleTable("#categoryTable", categorySorted, "hang muc");
  renderSimpleTable("#channelTable", channelSorted, "kenh");
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
  renderMissingTable(person, month);
}

function setFilters() {
  personFilterEl.innerHTML = `<option value="ALL">Tat ca</option>${personList.map((p) => `<option value="${p}">${p}</option>`).join("")}`;
  monthFilterEl.innerHTML = `<option value="ALL">Tat ca</option>${monthList.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("")}`;
}

async function load() {
  const response = await fetch("./data/snapshot.json", { cache: "no-store" });
  snapshot = await response.json();
  personList = Object.keys(snapshot.byPerson || {}).sort((a, b) => a.localeCompare(b));
  monthList = [...new Set(snapshot.latestRows.map((r) => r.month).filter((v) => v && v !== "(khong ngay)"))]
    .sort((a, b) => a.localeCompare(b));

  updatedAtEl.textContent = `Cap nhat: ${formatDate(snapshot.metadata.generatedAt)}`;
  totalRecordsEl.textContent = `Tong record: ${formatNumber(snapshot.metadata.totalRecords)}`;
  setFilters();
  render();
}

personFilterEl.addEventListener("change", render);
monthFilterEl.addEventListener("change", render);
reloadBtn.addEventListener("click", load);

load().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  updatedAtEl.textContent = "Loi nap du lieu";
});
