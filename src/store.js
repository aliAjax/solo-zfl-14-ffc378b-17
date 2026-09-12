// 本地存储：只写浏览器 localStorage。
// 读取异常（无数据、JSON 损坏、getItem 抛错）返回 null，由调用方回退到空列表；
// 保存失败（配额满、隐私模式抛错）返回 false，不向上抛错、不阻断页面。

export function loadState(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveState(storage, key, state) {
  try {
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
