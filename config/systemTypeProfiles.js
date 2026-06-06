const SYSTEM_TYPE_PROFILES_VERSION = "2026-beta-1";

const SYSTEM_TYPE_PROFILES = {
  budget: {
    id: "budget",
    label: "Lowest sensible upfront cost",
    description:
      "Prioritises lower upfront hardware cost while still requiring technical compatibility.",
    weights: {
      cost: 0.45,
      compatibility: 0.30,
      warranty: 0.10,
      optimisation: 0.05,
      backup: 0.025,
      monitoring: 0.025,
      exportControl: 0.025,
      aesthetics: 0.025,
    },
  },

  balanced: {
    id: "balanced",
    label: "Balanced system",
    description:
      "Balances cost, compatibility, warranty, monitoring and future flexibility.",
    weights: {
      cost: 0.22,
      compatibility: 0.32,
      warranty: 0.14,
      optimisation: 0.12,
      backup: 0.06,
      monitoring: 0.06,
      exportControl: 0.04,
      aesthetics: 0.04,
    },
  },

  premium_integrated: {
    id: "premium_integrated",
    label: "Premium integrated system",
    description:
      "Prioritises integrated ecosystems, advanced control, monitoring, backup readiness and premium system quality.",
    weights: {
      cost: 0.08,
      compatibility: 0.26,
      warranty: 0.14,
      optimisation: 0.18,
      backup: 0.12,
      monitoring: 0.12,
      exportControl: 0.06,
      aesthetics: 0.04,
    },
  },

  backup_ready: {
    id: "backup_ready",
    label: "Backup-ready system",
    description:
      "Prioritises backup-compatible inverter and battery combinations.",
    weights: {
      cost: 0.08,
      compatibility: 0.30,
      warranty: 0.10,
      optimisation: 0.12,
      backup: 0.28,
      monitoring: 0.04,
      exportControl: 0.06,
      aesthetics: 0.02,
    },
  },

  shaded_roof: {
    id: "shaded_roof",
    label: "Shaded or complex roof system",
    description:
      "Prioritises designs suited to shading, mixed orientations, mixed tilts and module-level optimisation.",
    weights: {
      cost: 0.08,
      compatibility: 0.30,
      warranty: 0.08,
      optimisation: 0.32,
      backup: 0.04,
      monitoring: 0.10,
      exportControl: 0.04,
      aesthetics: 0.04,
    },
  },

  monitoring_focused: {
    id: "monitoring_focused",
    label: "Best monitoring",
    description:
      "Prioritises monitoring capability and visibility of system performance.",
    weights: {
      cost: 0.08,
      compatibility: 0.26,
      warranty: 0.10,
      optimisation: 0.12,
      backup: 0.04,
      monitoring: 0.32,
      exportControl: 0.04,
      aesthetics: 0.04,
    },
  },

  warranty_focused: {
    id: "warranty_focused",
    label: "Best warranty",
    description:
      "Prioritises stronger warranty position and long-term supportability.",
    weights: {
      cost: 0.08,
      compatibility: 0.28,
      warranty: 0.38,
      optimisation: 0.08,
      backup: 0.04,
      monitoring: 0.06,
      exportControl: 0.04,
      aesthetics: 0.04,
    },
  },

  export_control_focused: {
    id: "export_control_focused",
    label: "G100 / export-control focused",
    description:
      "Prioritises systems likely to support export limiting, G100-style control and future smart grid control.",
    weights: {
      cost: 0.08,
      compatibility: 0.30,
      warranty: 0.08,
      optimisation: 0.16,
      backup: 0.05,
      monitoring: 0.10,
      exportControl: 0.20,
      aesthetics: 0.03,
    },
  },

  aesthetics_focused: {
    id: "aesthetics_focused",
    label: "Best aesthetics",
    description:
      "Prioritises premium-looking panels and neat integrated system design.",
    weights: {
      cost: 0.08,
      compatibility: 0.28,
      warranty: 0.12,
      optimisation: 0.10,
      backup: 0.04,
      monitoring: 0.06,
      exportControl: 0.04,
      aesthetics: 0.28,
    },
  },
};

function getSystemTypeProfile(systemType = "balanced") {
  const key = String(systemType || "balanced").trim();

  return SYSTEM_TYPE_PROFILES[key] || SYSTEM_TYPE_PROFILES.balanced;
}

function listSystemTypeProfiles() {
  return Object.values(SYSTEM_TYPE_PROFILES);
}

module.exports = {
  SYSTEM_TYPE_PROFILES_VERSION,
  SYSTEM_TYPE_PROFILES,
  getSystemTypeProfile,
  listSystemTypeProfiles,
};