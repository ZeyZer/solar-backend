const fs = require("fs");
const path = require("path");

const HARDWARE_DIR = path.join(__dirname, "..", "data", "hardware");

const HARDWARE_FILES = {
  batteries: "batteries.json",
  panels: "panels.json",
  inverters: "inverters.json",
};

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function loadHardwareCategory(category) {
  const fileName = HARDWARE_FILES[category];

  if (!fileName) {
    throw new Error(`Unknown hardware category: ${category}`);
  }

  const filePath = path.join(HARDWARE_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Hardware file missing: ${filePath}`);
  }

  const items = readJsonFile(filePath);

  if (!Array.isArray(items)) {
    throw new Error(`Hardware file must contain an array: ${fileName}`);
  }

  return items;
}

function getHardwareCatalog() {
  return {
    batteries: loadHardwareCategory("batteries"),
    panels: loadHardwareCategory("panels"),
    inverters: loadHardwareCategory("inverters"),
  };
}

function listActiveItems(category) {
  return loadHardwareCategory(category).filter((item) => item.isActive !== false);
}

function listActiveBatteries() {
  return listActiveItems("batteries");
}

function listActivePanels() {
  return listActiveItems("panels");
}

function listActiveInverters() {
  return listActiveItems("inverters");
}

function findItemById(category, id) {
  const safeId = String(id || "").trim();

  if (!safeId) return null;

  return loadHardwareCategory(category).find((item) => item.id === safeId) || null;
}

function findBatteryById(id) {
  return findItemById("batteries", id);
}

function findPanelById(id) {
  return findItemById("panels", id);
}

function findInverterById(id) {
  return findItemById("inverters", id);
}

function findClosestBatteryByUsableKWh(targetUsableKWh, options = {}) {
  const target = Number(targetUsableKWh || 0);

  const batteries = listActiveBatteries().filter((battery) => {
    if (!Number.isFinite(Number(battery.usableCapacityKWh))) return false;

    if (options.batteryType) {
      return battery.batteryType === options.batteryType;
    }

    return true;
  });

  if (!batteries.length) return null;

  return batteries.reduce((best, current) => {
    const bestDistance = Math.abs(Number(best.usableCapacityKWh || 0) - target);
    const currentDistance = Math.abs(Number(current.usableCapacityKWh || 0) - target);

    if (currentDistance < bestDistance) return current;

    // If equally close, prefer the smaller battery to avoid over-sizing by default.
    if (currentDistance === bestDistance) {
      return Number(current.usableCapacityKWh || 0) < Number(best.usableCapacityKWh || 0)
        ? current
        : best;
    }

    return best;
  }, batteries[0]);
}

function getHardwareCatalogSummary() {
  const catalog = getHardwareCatalog();

  return {
    batteries: {
      total: catalog.batteries.length,
      active: catalog.batteries.filter((item) => item.isActive !== false).length,
    },
    panels: {
      total: catalog.panels.length,
      active: catalog.panels.filter((item) => item.isActive !== false).length,
    },
    inverters: {
      total: catalog.inverters.length,
      active: catalog.inverters.filter((item) => item.isActive !== false).length,
    },
  };
}

module.exports = {
  HARDWARE_DIR,
  HARDWARE_FILES,
  loadHardwareCategory,
  getHardwareCatalog,
  listActiveItems,
  listActiveBatteries,
  listActivePanels,
  listActiveInverters,
  findItemById,
  findBatteryById,
  findPanelById,
  findInverterById,
  findClosestBatteryByUsableKWh,
  getHardwareCatalogSummary,
};