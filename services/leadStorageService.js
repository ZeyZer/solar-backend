const fs = require("fs");
const path = require("path");

const LEADS_FILE = path.join(__dirname, "..", "leads.json");

function readLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) {
      console.log("leads.json does not exist yet, starting with empty array.");
      return [];
    }

    const data = fs.readFileSync(LEADS_FILE, "utf8");

    if (!data.trim()) {
      console.log("leads.json is empty, starting with empty array.");
      return [];
    }

    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading leads file:", err.message);
    return [];
  }
}

function saveLeads(leads) {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
    console.log(`Saved leads to ${LEADS_FILE}. Total leads: ${leads.length}`);
  } catch (err) {
    console.error("Error writing leads file:", err.message);
  }
}

module.exports = {
  LEADS_FILE,
  readLeads,
  saveLeads,
};