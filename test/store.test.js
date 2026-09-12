import { describe, it, expect } from "vitest";
import { loadState, saveState } from "../src/store.js";
import { normalizeState, createEmptyState } from "../src/domain.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

describe("本地存储", () => {
  it("保存后刷新（重新读取）数据不丢失", () => {
    const storage = memoryStorage();
    const state = createEmptyState();
    state.rooms.push({ id: "r1", name: "厨房" });
    expect(saveState(storage, "k", state)).toBe(true);
    const loaded = normalizeState(loadState(storage, "k"));
    expect(loaded.rooms).toEqual([{ id: "r1", name: "厨房" }]);
  });

  it("无数据时返回 null，调用方回退空列表", () => {
    const storage = memoryStorage();
    expect(loadState(storage, "missing")).toBeNull();
    expect(normalizeState(loadState(storage, "missing"))).toEqual(createEmptyState());
  });

  it("JSON 损坏时读取回到空列表", () => {
    const storage = memoryStorage();
    storage.setItem("k", "{not-json");
    expect(loadState(storage, "k")).toBeNull();
    expect(normalizeState(loadState(storage, "k"))).toEqual(createEmptyState());
  });

  it("getItem 抛异常时读取回到空列表", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {}
    };
    expect(loadState(storage, "k")).toBeNull();
    expect(normalizeState(loadState(storage, "k"))).toEqual(createEmptyState());
  });

  it("setItem 抛异常时保存返回 false 且不抛错", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      }
    };
    expect(() => saveState(storage, "k", createEmptyState())).not.toThrow();
    expect(saveState(storage, "k", createEmptyState())).toBe(false);
  });
});
