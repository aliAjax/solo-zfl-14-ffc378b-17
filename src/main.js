import "./styles.css";
import {
  STORAGE_KEY,
  PRIORITIES,
  REPAIR_STATUSES,
  createEmptyState,
  normalizeState,
  addRoom,
  addDevice,
  addRepair,
  saveRecord,
  findRoom,
  findDevice,
  nextMaintenanceDate,
  maintenanceReminders,
  completeMaintenance,
  monthlyCostSummary,
  recordCost,
  todayString
} from "./domain.js";
import { loadState, saveState } from "./store.js";

const app = document.querySelector("#app");
const state = normalizeState(loadState(localStorage, STORAGE_KEY)) ?? createEmptyState();
let submitting = false;

const TABS = {
  home: "首页提醒",
  archive: "设备档案",
  repairs: "报修",
  records: "处理记录",
  summary: "费用汇总"
};

function persist() {
  // 保存失败只提示，不阻断页面继续使用。
  if (!saveState(localStorage, STORAGE_KEY, state)) {
    console.warn("本地保存失败，本次改动仅保留在当前页面中。");
  }
}

function deviceLabel(device) {
  const room = findRoom(state, device.roomId);
  return `${room ? room.name : "未分房间"} · ${device.name}`;
}

function render() {
  const tab = TABS[state.ui.tab] ? state.ui.tab : "home";
  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>设备保养档案</h1>
        </div>
        <nav class="toolbar">
          ${Object.entries(TABS)
            .map(([key, label]) => `<button class="seg ${tab === key ? "active" : ""}" data-tab="${key}">${label}</button>`)
            .join("")}
        </nav>
      </header>
      <section class="page">${renderTab(tab)}</section>
    </main>
  `;
  bindCommonEvents();
  bindTabEvents(tab);
}

function renderTab(tab) {
  if (tab === "archive") return renderArchive();
  if (tab === "repairs") return renderRepairs();
  if (tab === "records") return renderRecords();
  if (tab === "summary") return renderSummary();
  return renderHome();
}

// ---------- 首页提醒 ----------

function renderHome() {
  const today = todayString();
  const reminders = maintenanceReminders(state.devices, today);
  const openRepairs = state.repairs.filter((repair) => repair.status === "open");
  return `
    <section class="stats">
      <div class="stat"><span>设备总数</span><strong>${state.devices.length}</strong></div>
      <div class="stat"><span>保养提醒</span><strong>${reminders.length}</strong></div>
      <div class="stat"><span>待处理报修</span><strong>${openRepairs.length}</strong></div>
    </section>
    <section class="panel">
      <h2>到期 / 逾期保养</h2>
      ${
        reminders.length
          ? `<div class="cards">${reminders
              .map(
                (item) => `
              <article class="card ${item.status}">
                <div class="row">
                  <h3>${escapeHtml(deviceLabel(item.device))}</h3>
                  <span class="status ${item.status}">${item.status === "overdue" ? `已逾期 ${-item.days} 天` : item.days === 0 ? "今天到期" : `${item.days} 天后到期`}</span>
                </div>
                <p>${escapeHtml(item.device.brand)} ${escapeHtml(item.device.model)} · 每 ${item.device.cycleMonths} 个月保养</p>
                <p>下次保养日：${item.nextDate}</p>
                <div class="actions"><button class="ghost" data-done-maintenance="${item.device.id}">登记已保养</button></div>
              </article>`
              )
              .join("")}</div>`
          : `<div class="empty">暂无到期或逾期的保养事项</div>`
      }
    </section>
  `;
}

// ---------- 设备档案 ----------

function renderArchive() {
  const roomOptions = state.rooms.map((room) => `<option value="${room.id}">${escapeHtml(room.name)}</option>`).join("");
  const groups = state.rooms
    .map((room) => ({ room, devices: state.devices.filter((device) => device.roomId === room.id) }))
    .filter((group) => group.devices.length);
  return `
    <section class="layout">
      <aside class="panel">
        <h2>登记房间</h2>
        <form class="form" id="room-form">
          <label>房间名称<input name="name" required placeholder="例如厨房"></label>
          <button class="primary" type="submit">保存房间</button>
        </form>
        <h2 style="margin-top:20px">登记设备</h2>
        <form class="form" id="device-form">
          <label>所属房间<select name="roomId" required>${roomOptions}</select></label>
          <label>设备名称<input name="name" required placeholder="例如空调"></label>
          <label>品牌<input name="brand" placeholder="例如格力"></label>
          <label>型号<input name="model" placeholder="例如 KFR-35GW"></label>
          <label>启用时间<input name="startDate" type="date" required></label>
          <label>保养周期（月）<input name="cycleMonths" type="number" min="1" step="1" value="6" required></label>
          <button class="primary" type="submit" ${state.rooms.length ? "" : "disabled"}>保存设备</button>
        </form>
        ${state.rooms.length ? "" : `<p class="hint">请先登记一个房间，再登记设备。</p>`}
      </aside>
      <section>
        ${
          groups.length
            ? groups
                .map(
                  (group) => `
            <section class="panel group">
              <h2>${escapeHtml(group.room.name)}（${group.devices.length} 台）</h2>
              <div class="cards">
                ${group.devices
                  .map(
                    (device) => `
                  <article class="card">
                    <div class="row"><h3>${escapeHtml(device.name)}</h3><span class="chip">下次保养 ${nextMaintenanceDate(device)}</span></div>
                    <p>${escapeHtml(device.brand || "未填品牌")} ${escapeHtml(device.model || "")}</p>
                    <p>启用时间 ${device.startDate} · 每 ${device.cycleMonths} 个月保养</p>
                    <div class="actions"><button class="ghost" data-delete-device="${device.id}">删除设备</button></div>
                  </article>`
                  )
                  .join("")}
              </div>
            </section>`
                )
                .join("")
            : `<div class="empty">还没有设备档案，先在左侧登记房间和设备</div>`
        }
      </section>
    </section>
  `;
}

// ---------- 报修 ----------

function renderRepairs() {
  const filter = state.ui.roomFilter;
  const devices = filter === "all" ? state.devices : state.devices.filter((device) => device.roomId === filter);
  const deviceIds = new Set(devices.map((device) => device.id));
  const repairs = state.repairs.filter((repair) => deviceIds.has(repair.deviceId));
  const deviceOptions = state.devices
    .map((device) => `<option value="${device.id}">${escapeHtml(deviceLabel(device))}</option>`)
    .join("");
  return `
    <section class="layout">
      <aside class="panel">
        <h2>新增报修</h2>
        <form class="form" id="repair-form">
          <label>设备<select name="deviceId" required>${deviceOptions}</select></label>
          <label>问题描述<textarea name="problem" required placeholder="例如制冷效果差"></textarea></label>
          <label>优先级<select name="priority">${Object.entries(PRIORITIES)
            .map(([value, label]) => `<option value="${value}">${label}</option>`)
            .join("")}</select></label>
          <label>预计花费（元）<input name="estimatedCost" type="number" min="0" step="0.01" value="0"></label>
          <label>计划完成日<input name="plannedDate" type="date"></label>
          <button class="primary" type="submit" ${state.devices.length ? "" : "disabled"}>提交报修</button>
        </form>
        ${state.devices.length ? "" : `<p class="hint">请先在「设备档案」中登记设备。</p>`}
      </aside>
      <section>
        <div class="toolbar">
          <button class="seg ${filter === "all" ? "active" : ""}" data-room-filter="all">全部房间</button>
          ${state.rooms
            .map((room) => `<button class="seg ${filter === room.id ? "active" : ""}" data-room-filter="${room.id}">${escapeHtml(room.name)}</button>`)
            .join("")}
        </div>
        <div class="cards">
          ${
            repairs.length
              ? repairs
                  .map((repair) => {
                    const device = findDevice(state, repair.deviceId);
                    return `
                <article class="card">
                  <div class="row">
                    <h3>${escapeHtml(device ? deviceLabel(device) : "未知设备")}</h3>
                    <span class="priority ${repair.priority}">${PRIORITIES[repair.priority]}</span>
                    <span class="status ${repair.status}">${REPAIR_STATUSES[repair.status]}</span>
                  </div>
                  <p>${escapeHtml(repair.problem)}</p>
                  <div class="row">
                    <span class="chip">预计 ¥${repair.estimatedCost}</span>
                    <span class="chip">计划完成 ${repair.plannedDate || "未填"}</span>
                  </div>
                  <div class="actions"><button class="ghost" data-delete-repair="${repair.id}">删除</button></div>
                </article>`;
                  })
                  .join("")
              : `<div class="empty">当前房间没有报修事项</div>`
          }
        </div>
      </section>
    </section>
  `;
}

// ---------- 处理记录 ----------

function renderRecords() {
  const openRepairs = state.repairs.filter((repair) => repair.status === "open");
  const repairOptions = openRepairs
    .map((repair) => {
      const device = findDevice(state, repair.deviceId);
      return `<option value="${repair.id}">${escapeHtml(device ? deviceLabel(device) : "未知设备")}｜${escapeHtml(repair.problem)}</option>`;
    })
    .join("");
  return `
    <section class="layout">
      <aside class="panel">
        <h2>登记处理记录</h2>
        <form class="form" id="record-form">
          <label>报修事项<select name="repairId" required>${repairOptions}</select></label>
          <label>维修人<input name="technician" required placeholder="例如张师傅"></label>
          <label>开始时间<input name="startTime" type="datetime-local" required></label>
          <label>结束时间<input name="endTime" type="datetime-local" required></label>
          <fieldset class="materials">
            <legend>耗材（名称 / 数量 / 单价）</legend>
            <div id="material-rows"></div>
            <button class="ghost" type="button" id="add-material">添加耗材</button>
          </fieldset>
          <label>处理结果<textarea name="result" placeholder="例如更换电容后恢复正常"></textarea></label>
          <button class="primary" type="submit" ${openRepairs.length ? "" : "disabled"}>保存记录</button>
        </form>
        ${openRepairs.length ? "" : `<p class="hint">没有待处理的报修事项。</p>`}
      </aside>
      <section>
        <div class="cards">
          ${
            state.records.length
              ? state.records
                  .map((record) => {
                    const repair = state.repairs.find((item) => item.id === record.repairId);
                    const device = repair ? findDevice(state, repair.deviceId) : null;
                    return `
                <article class="card">
                  <div class="row">
                    <h3>${escapeHtml(device ? deviceLabel(device) : "未知设备")}</h3>
                    <span class="chip">维修人 ${escapeHtml(record.technician || "未填")}</span>
                    <span class="chip">工时 ${record.hours} 小时</span>
                    <span class="chip">耗材 ¥${recordCost(record)}</span>
                  </div>
                  <p>${escapeHtml(repair ? repair.problem : "")}</p>
                  <p>${record.startTime} ～ ${record.endTime}</p>
                  ${
                    record.materials.length
                      ? `<ul class="materials-list">${record.materials
                          .map((item) => `<li>${escapeHtml(item.name)} × ${item.qty} × ¥${item.price}</li>`)
                          .join("")}</ul>`
                      : ""
                  }
                  <p>结果：${escapeHtml(record.result || "未填")}</p>
                </article>`;
                  })
                  .join("")
              : `<div class="empty">还没有处理记录</div>`
          }
        </div>
      </section>
    </section>
  `;
}

// ---------- 费用汇总 ----------

function renderSummary() {
  const rows = monthlyCostSummary(state);
  return `
    <section class="panel">
      <h2>按月汇总每台设备花费（按耗材实际费用）</h2>
      ${
        rows.length
          ? `<table class="table">
            <thead><tr><th>月份</th><th>房间</th><th>设备</th><th>花费（元）</th></tr></thead>
            <tbody>
              ${rows
                .map((row) => {
                  const device = findDevice(state, row.deviceId);
                  const room = device ? findRoom(state, device.roomId) : null;
                  return `<tr>
                    <td>${row.month}</td>
                    <td>${escapeHtml(room ? room.name : "未知")}</td>
                    <td>${escapeHtml(device ? device.name : "未知设备")}</td>
                    <td>¥${row.cost}</td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>`
          : `<div class="empty">还没有产生费用的处理记录</div>`
      }
    </section>
  `;
}

// ---------- 事件 ----------

function bindCommonEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ui.tab = button.dataset.tab;
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-done-maintenance]").forEach((button) => {
    button.addEventListener("click", () => {
      completeMaintenance(state, button.dataset.doneMaintenance, todayString());
      persist();
      render();
    });
  });
}

function bindTabEvents(tab) {
  if (tab === "archive") bindArchiveEvents();
  if (tab === "repairs") bindRepairEvents();
  if (tab === "records") bindRecordEvents();
}

function bindArchiveEvents() {
  document.querySelector("#room-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const data = Object.fromEntries(new FormData(event.target));
    addRoom(state, data.name);
    persist();
    submitting = false;
    render();
  });

  document.querySelector("#device-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const data = Object.fromEntries(new FormData(event.target));
    addDevice(state, data);
    persist();
    submitting = false;
    render();
  });

  document.querySelectorAll("[data-delete-device]").forEach((button) => {
    button.addEventListener("click", () => {
      const deviceId = button.dataset.deleteDevice;
      state.devices = state.devices.filter((device) => device.id !== deviceId);
      const repairIds = new Set(state.repairs.filter((repair) => repair.deviceId === deviceId).map((repair) => repair.id));
      state.repairs = state.repairs.filter((repair) => repair.deviceId !== deviceId);
      state.records = state.records.filter((record) => !repairIds.has(record.repairId));
      persist();
      render();
    });
  });
}

function bindRepairEvents() {
  const form = document.querySelector("#repair-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (submitting) return;
      submitting = true;
      const data = Object.fromEntries(new FormData(event.target));
      addRepair(state, data);
      persist();
      submitting = false;
      render();
    });
  }

  document.querySelectorAll("[data-room-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.ui.roomFilter = button.dataset.roomFilter;
      persist();
      render();
    });
  });

  document.querySelectorAll("[data-delete-repair]").forEach((button) => {
    button.addEventListener("click", () => {
      state.repairs = state.repairs.filter((repair) => repair.id !== button.dataset.deleteRepair);
      persist();
      render();
    });
  });
}

function bindRecordEvents() {
  const rows = document.querySelector("#material-rows");
  const addRow = () => {
    const row = document.createElement("div");
    row.className = "material-row";
    row.innerHTML = `
      <input name="materialName" placeholder="名称">
      <input name="materialQty" type="number" min="0" step="1" placeholder="数量">
      <input name="materialPrice" type="number" min="0" step="0.01" placeholder="单价">
    `;
    rows.appendChild(row);
  };
  addRow();
  document.querySelector("#add-material").addEventListener("click", addRow);

  const form = document.querySelector("#record-form");
  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (submitting) return;
      submitting = true;
      const data = new FormData(event.target);
      const names = data.getAll("materialName");
      const qtys = data.getAll("materialQty");
      const prices = data.getAll("materialPrice");
      const materials = names.map((name, index) => ({ name, qty: qtys[index], price: prices[index] }));
      saveRecord(state, {
        repairId: data.get("repairId"),
        technician: data.get("technician"),
        startTime: data.get("startTime"),
        endTime: data.get("endTime"),
        materials,
        result: data.get("result")
      });
      persist();
      submitting = false;
      render();
    });
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
