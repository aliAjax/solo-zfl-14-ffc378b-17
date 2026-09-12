// 领域逻辑：设备保养档案、保养提醒、报修、处理记录、费用汇总。
// 全部为纯函数（直接修改传入的 state 并返回结果实体），不依赖 DOM 与 localStorage，便于测试。

export const STORAGE_KEY = "zfl-14-maintenance-v1";

export const PRIORITIES = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

export const REPAIR_STATUSES = {
  open: "待处理",
  done: "已处理"
};

export function createEmptyState() {
  return {
    rooms: [],
    devices: [],
    repairs: [],
    records: [],
    ui: { tab: "home", roomFilter: "all" }
  };
}

// 读取到的数据做任何字段缺失/类型不符时，回退到空列表，保证页面可用。
export function normalizeState(raw) {
  const empty = createEmptyState();
  if (!raw || typeof raw !== "object") return empty;
  return {
    rooms: Array.isArray(raw.rooms) ? raw.rooms : [],
    devices: Array.isArray(raw.devices) ? raw.devices : [],
    repairs: Array.isArray(raw.repairs) ? raw.repairs : [],
    records: Array.isArray(raw.records) ? raw.records : [],
    ui: {
      tab: typeof raw.ui?.tab === "string" ? raw.ui.tab : "home",
      roomFilter: typeof raw.ui?.roomFilter === "string" ? raw.ui.roomFilter : "all"
    }
  };
}

let idSeed = 0;
export function genId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  idSeed += 1;
  return `id-${Date.now()}-${idSeed}`;
}

// ---------- 房间与设备档案 ----------

export function findRoom(state, roomId) {
  return state.rooms.find((room) => room.id === roomId) || null;
}

export function findDevice(state, deviceId) {
  return state.devices.find((device) => device.id === deviceId) || null;
}

// 同名房间不重复登记，返回 { room, added }。
export function addRoom(state, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return { room: null, added: false };
  const existing = state.rooms.find((room) => room.name === trimmed);
  if (existing) return { room: existing, added: false };
  const room = { id: genId(), name: trimmed };
  state.rooms.push(room);
  return { room, added: true };
}

// 同一房间内 名称+品牌+型号 相同的设备视为同一台，不重复登记。
export function addDevice(state, input) {
  const device = {
    id: genId(),
    roomId: input.roomId,
    name: String(input.name || "").trim(),
    brand: String(input.brand || "").trim(),
    model: String(input.model || "").trim(),
    startDate: input.startDate,
    cycleMonths: Number(input.cycleMonths)
  };
  if (!findRoom(state, device.roomId)) return { device: null, added: false };
  if (!device.name || !device.startDate || !Number.isFinite(device.cycleMonths) || device.cycleMonths < 1) {
    return { device: null, added: false };
  }
  const duplicated = state.devices.some(
    (item) =>
      item.roomId === device.roomId &&
      item.name === device.name &&
      item.brand === device.brand &&
      item.model === device.model
  );
  if (duplicated) return { device: null, added: false };
  state.devices.push(device);
  return { device, added: true };
}

// ---------- 保养周期推算与到期提醒 ----------

// 日期加 N 个月，日超出目标月天数时收敛到月末。输入输出均为 YYYY-MM-DD。
export function addMonths(dateStr, months) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const total = (year * 12 + (month - 1)) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  const nextDay = Math.min(day, lastDay);
  const pad = (value) => String(value).padStart(2, "0");
  return `${nextYear}-${pad(nextMonth)}-${pad(nextDay)}`;
}

export function todayString(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// 下次保养日：上次保养完成日（未保养过则为启用时间）+ 一个周期。
// 该日期早于今天即逾期，因此需要 completeMaintenance 登记保养完成来向后滚动。
export function nextMaintenanceDate(device) {
  return addMonths(device.lastMaintenance || device.startDate, device.cycleMonths);
}

// 登记保养完成：把锚点推进到 doneDate，下次保养日随之滚动。同一日期重复登记结果相同。
export function completeMaintenance(state, deviceId, doneDate) {
  const device = findDevice(state, deviceId);
  if (!device || !doneDate) return false;
  device.lastMaintenance = doneDate;
  return true;
}

export function diffDays(laterStr, earlierStr) {
  const toTime = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toTime(laterStr) - toTime(earlierStr)) / 86400000);
}

// 到期提醒：nextDate 早于今天为逾期（overdue），今天起 dueWithinDays 天内为到期（due）。
export function maintenanceReminders(devices, today, dueWithinDays = 7) {
  return devices
    .map((device) => {
      const nextDate = nextMaintenanceDate(device, today);
      const days = diffDays(nextDate, today);
      const status = days < 0 ? "overdue" : days <= dueWithinDays ? "due" : "ok";
      return { device, nextDate, days, status };
    })
    .filter((item) => item.status !== "ok")
    .sort((a, b) => a.days - b.days);
}

// ---------- 报修 ----------

// 同一设备、同一问题描述且仍未处理的报修视为同一事项，不重复生成。
export function addRepair(state, input) {
  const repair = {
    id: genId(),
    deviceId: input.deviceId,
    problem: String(input.problem || "").trim(),
    priority: input.priority in PRIORITIES ? input.priority : "medium",
    estimatedCost: Math.max(0, Number(input.estimatedCost) || 0),
    plannedDate: input.plannedDate || "",
    status: "open",
    createdAt: input.createdAt || todayString()
  };
  if (!findDevice(state, repair.deviceId) || !repair.problem) {
    return { repair: null, added: false };
  }
  const duplicated = state.repairs.some(
    (item) => item.deviceId === repair.deviceId && item.problem === repair.problem && item.status === "open"
  );
  if (duplicated) return { repair: null, added: false };
  state.repairs.unshift(repair);
  return { repair, added: true };
}

// ---------- 处理记录 ----------

export function workHours(startTime, endTime) {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round(((end - start) / 3600000) * 10) / 10;
}

export function normalizeMaterial(input) {
  return {
    name: String(input.name || "").trim(),
    qty: Math.max(0, Number(input.qty) || 0),
    price: Math.max(0, Number(input.price) || 0)
  };
}

export function recordCost(record) {
  return record.materials.reduce((total, item) => total + item.qty * item.price, 0);
}

// 每个报修事项只保留一条处理记录：同一 repairId 再次保存时覆盖，不重复生成。
export function saveRecord(state, input) {
  const repair = state.repairs.find((item) => item.id === input.repairId);
  if (!repair) return { record: null, added: false };
  const materials = (Array.isArray(input.materials) ? input.materials : [])
    .map(normalizeMaterial)
    .filter((item) => item.name && item.qty > 0);
  const existing = state.records.find((item) => item.repairId === repair.id);
  const record = existing || { id: genId(), repairId: repair.id };
  record.technician = String(input.technician || "").trim();
  record.startTime = input.startTime || "";
  record.endTime = input.endTime || "";
  record.hours = workHours(record.startTime, record.endTime);
  record.materials = materials;
  record.result = String(input.result || "").trim();
  if (!existing) state.records.unshift(record);
  repair.status = "done";
  return { record, added: !existing };
}

// ---------- 按月汇总每台设备花费 ----------

export function monthlyCostSummary(state) {
  const byMonthAndDevice = new Map();
  for (const record of state.records) {
    const month = (record.endTime || record.startTime || "").slice(0, 7);
    if (!month) continue;
    const repair = state.repairs.find((item) => item.id === record.repairId);
    if (!repair) continue;
    const key = `${month}|${repair.deviceId}`;
    byMonthAndDevice.set(key, (byMonthAndDevice.get(key) || 0) + recordCost(record));
  }
  return [...byMonthAndDevice.entries()]
    .map(([key, cost]) => {
      const [month, deviceId] = key.split("|");
      return { month, deviceId, cost: Math.round(cost * 100) / 100 };
    })
    .sort((a, b) => {
      if (a.month !== b.month) return a.month < b.month ? 1 : -1;
      return a.deviceId < b.deviceId ? -1 : 1;
    });
}
