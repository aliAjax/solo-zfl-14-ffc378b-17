import { describe, it, expect } from "vitest";
import {
  createEmptyState,
  normalizeState,
  addRoom,
  addDevice,
  addRepair,
  saveRecord,
  addMonths,
  nextMaintenanceDate,
  completeMaintenance,
  maintenanceReminders,
  workHours,
  recordCost,
  monthlyCostSummary
} from "../src/domain.js";

function seedState() {
  const state = createEmptyState();
  const { room } = addRoom(state, "厨房");
  const { device } = addDevice(state, {
    roomId: room.id,
    name: "空调",
    brand: "格力",
    model: "KFR-35GW",
    startDate: "2026-01-15",
    cycleMonths: 3
  });
  return { state, room, device };
}

describe("设备档案", () => {
  it("登记房间与设备，字段完整保留", () => {
    const { state, room, device } = seedState();
    expect(state.rooms).toHaveLength(1);
    expect(room.name).toBe("厨房");
    expect(device.brand).toBe("格力");
    expect(device.model).toBe("KFR-35GW");
    expect(device.startDate).toBe("2026-01-15");
    expect(device.cycleMonths).toBe(3);
  });

  it("同名房间不重复登记", () => {
    const state = createEmptyState();
    const first = addRoom(state, "厨房");
    const second = addRoom(state, " 厨房 ");
    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(state.rooms).toHaveLength(1);
  });

  it("同房间同名称品牌型号的设备不重复登记", () => {
    const { state, room } = seedState();
    const again = addDevice(state, {
      roomId: room.id,
      name: "空调",
      brand: "格力",
      model: "KFR-35GW",
      startDate: "2026-02-01",
      cycleMonths: 6
    });
    expect(again.added).toBe(false);
    expect(state.devices).toHaveLength(1);
  });

  it("拒绝登记到不存在的房间或非法周期", () => {
    const state = createEmptyState();
    expect(addDevice(state, { roomId: "ghost", name: "空调", startDate: "2026-01-01", cycleMonths: 3 }).added).toBe(false);
    const { room } = addRoom(state, "卧室");
    expect(addDevice(state, { roomId: room.id, name: "空调", startDate: "2026-01-01", cycleMonths: 0 }).added).toBe(false);
    expect(state.devices).toHaveLength(0);
  });
});

describe("保养周期推算与提醒", () => {
  it("addMonths 处理月末收敛", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", 3)).toBe("2026-04-15");
    expect(addMonths("2025-11-15", 3)).toBe("2026-02-15");
  });

  it("按周期推算下次保养日", () => {
    const device = { startDate: "2026-01-15", cycleMonths: 3 };
    expect(nextMaintenanceDate(device)).toBe("2026-04-15");
    expect(nextMaintenanceDate({ ...device, lastMaintenance: "2026-04-20" })).toBe("2026-07-20");
  });

  it("到期与逾期进入提醒，未到期不提醒", () => {
    const overdue = { id: "a", name: "热水器", startDate: "2026-01-01", cycleMonths: 2 };
    const due = { id: "b", name: "空调", startDate: "2026-03-15", cycleMonths: 6 };
    const ok = { id: "c", name: "冰箱", startDate: "2026-09-01", cycleMonths: 12 };
    const reminders = maintenanceReminders([overdue, due, ok], "2026-09-12");
    const byId = Object.fromEntries(reminders.map((item) => [item.device.id, item]));
    expect(byId.a.status).toBe("overdue");
    expect(byId.a.nextDate).toBe("2026-03-01");
    expect(byId.a.days).toBeLessThan(0);
    expect(byId.b.status).toBe("due");
    expect(byId.b.nextDate).toBe("2026-09-15");
    expect(byId.c).toBeUndefined();
    expect(reminders[0].device.id).toBe("a");
  });

  it("登记保养完成后下次保养日滚动，提醒消除", () => {
    const { state, device } = seedState();
    const before = maintenanceReminders(state.devices, "2026-09-12");
    expect(before).toHaveLength(1);
    expect(before[0].status).toBe("overdue");
    expect(completeMaintenance(state, device.id, "2026-09-12")).toBe(true);
    expect(nextMaintenanceDate(device)).toBe("2026-12-12");
    expect(maintenanceReminders(state.devices, "2026-09-12")).toHaveLength(0);
    // 同一天重复登记不产生额外变化
    completeMaintenance(state, device.id, "2026-09-12");
    expect(nextMaintenanceDate(device)).toBe("2026-12-12");
    expect(completeMaintenance(state, "ghost", "2026-09-12")).toBe(false);
  });
});

describe("报修", () => {
  it("登记报修并保留问题、优先级、预计花费、计划完成日", () => {
    const { state, device } = seedState();
    const { repair, added } = addRepair(state, {
      deviceId: device.id,
      problem: "制冷效果差",
      priority: "high",
      estimatedCost: 300,
      plannedDate: "2026-09-20"
    });
    expect(added).toBe(true);
    expect(repair.status).toBe("open");
    expect(repair.priority).toBe("high");
    expect(repair.estimatedCost).toBe(300);
    expect(repair.plannedDate).toBe("2026-09-20");
  });

  it("同一设备同一问题未处理时不重复生成", () => {
    const { state, device } = seedState();
    addRepair(state, { deviceId: device.id, problem: "漏水", priority: "high", estimatedCost: 100, plannedDate: "" });
    const again = addRepair(state, { deviceId: device.id, problem: "漏水", priority: "low", estimatedCost: 50, plannedDate: "" });
    expect(again.added).toBe(false);
    expect(state.repairs).toHaveLength(1);
  });

  it("问题处理完毕后允许再次报修同一问题", () => {
    const { state, device } = seedState();
    const { repair } = addRepair(state, { deviceId: device.id, problem: "漏水", priority: "high", estimatedCost: 100, plannedDate: "" });
    saveRecord(state, { repairId: repair.id, technician: "张师傅", startTime: "2026-09-01T09:00", endTime: "2026-09-01T10:00", materials: [], result: "已修复" });
    const again = addRepair(state, { deviceId: device.id, problem: "漏水", priority: "low", estimatedCost: 50, plannedDate: "" });
    expect(again.added).toBe(true);
    expect(state.repairs).toHaveLength(2);
  });
});

describe("处理记录", () => {
  it("记录维修人、起止时间、工时、耗材与结果，并把报修标记为已处理", () => {
    const { state, device } = seedState();
    const { repair } = addRepair(state, { deviceId: device.id, problem: "不制冷", priority: "high", estimatedCost: 500, plannedDate: "2026-09-15" });
    const { record, added } = saveRecord(state, {
      repairId: repair.id,
      technician: "张师傅",
      startTime: "2026-09-10T09:00",
      endTime: "2026-09-10T11:30",
      materials: [
        { name: "电容", qty: 1, price: 80 },
        { name: "冷媒", qty: 2, price: 60 }
      ],
      result: "更换电容并补充冷媒，恢复正常"
    });
    expect(added).toBe(true);
    expect(record.technician).toBe("张师傅");
    expect(record.hours).toBe(2.5);
    expect(recordCost(record)).toBe(200);
    expect(record.result).toContain("恢复正常");
    expect(state.repairs.find((item) => item.id === repair.id).status).toBe("done");
  });

  it("同一报修再次保存时覆盖而不是重复生成", () => {
    const { state, device } = seedState();
    const { repair } = addRepair(state, { deviceId: device.id, problem: "异响", priority: "low", estimatedCost: 0, plannedDate: "" });
    saveRecord(state, { repairId: repair.id, technician: "张师傅", startTime: "2026-09-01T09:00", endTime: "2026-09-01T10:00", materials: [], result: "初查" });
    const second = saveRecord(state, { repairId: repair.id, technician: "李师傅", startTime: "2026-09-01T09:00", endTime: "2026-09-01T12:00", materials: [{ name: "皮带", qty: 1, price: 45 }], result: "更换皮带" });
    expect(second.added).toBe(false);
    expect(state.records).toHaveLength(1);
    expect(state.records[0].technician).toBe("李师傅");
    expect(state.records[0].hours).toBe(3);
  });

  it("工时计算：非法或倒置时间为 0", () => {
    expect(workHours("2026-09-10T09:00", "2026-09-10T10:30")).toBe(1.5);
    expect(workHours("2026-09-10T10:00", "2026-09-10T09:00")).toBe(0);
    expect(workHours("", "2026-09-10T09:00")).toBe(0);
  });
});

describe("费用汇总", () => {
  it("按月汇总每台设备的耗材花费", () => {
    const { state, room, device } = seedState();
    const { device: second } = addDevice(state, { roomId: room.id, name: "热水器", brand: "美的", model: "F60", startDate: "2026-01-01", cycleMonths: 12 });
    const r1 = addRepair(state, { deviceId: device.id, problem: "不制冷", priority: "high", estimatedCost: 0, plannedDate: "" }).repair;
    const r2 = addRepair(state, { deviceId: device.id, problem: "漏水", priority: "medium", estimatedCost: 0, plannedDate: "" }).repair;
    const r3 = addRepair(state, { deviceId: second.id, problem: "不加热", priority: "high", estimatedCost: 0, plannedDate: "" }).repair;
    saveRecord(state, { repairId: r1.id, technician: "张", startTime: "2026-08-05T09:00", endTime: "2026-08-05T10:00", materials: [{ name: "电容", qty: 1, price: 80 }], result: "" });
    saveRecord(state, { repairId: r2.id, technician: "张", startTime: "2026-09-02T09:00", endTime: "2026-09-02T10:00", materials: [{ name: "水管", qty: 2, price: 15 }], result: "" });
    saveRecord(state, { repairId: r3.id, technician: "李", startTime: "2026-09-03T09:00", endTime: "2026-09-03T11:00", materials: [{ name: "加热管", qty: 1, price: 120 }], result: "" });
    const summary = monthlyCostSummary(state);
    const byKey = Object.fromEntries(summary.map((row) => [`${row.month}|${row.deviceId}`, row.cost]));
    expect(summary).toHaveLength(3);
    expect(byKey).toEqual({
      [`2026-08|${device.id}`]: 80,
      [`2026-09|${device.id}`]: 30,
      [`2026-09|${second.id}`]: 120
    });
    // 月份倒序排列
    expect(summary.map((row) => row.month)).toEqual([...summary.map((row) => row.month)].sort().reverse());
  });
});

describe("状态归一化", () => {
  it("字段缺失或类型错误时回退到空列表", () => {
    expect(normalizeState(null)).toEqual(createEmptyState());
    expect(normalizeState({ rooms: "bad", devices: 1, repairs: null, records: {} })).toEqual(createEmptyState());
    const partial = normalizeState({ rooms: [{ id: "r1", name: "厨房" }] });
    expect(partial.rooms).toHaveLength(1);
    expect(partial.devices).toEqual([]);
  });
});
