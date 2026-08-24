function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function choosePanelUtilisationFactors(capacityPanels, selector) {
  const panels = numberOrNull(capacityPanels);
  const source = selector?.recommendedConfig?.source;

  const reasons = [];

  let lowFactor;
  let expectedFactor;
  let highFactor;
  let profile;

  if (panels === null || panels <= 0) {
    return {
      profile: "unknown",
      lowFactor: null,
      expectedFactor: null,
      highFactor: null,
      reasons: ["No selected-roof capacity was available."],
    };
  }

  if (panels >= 70) {
    profile = "large_roof_capacity";
    lowFactor = 0.62;
    expectedFactor = 0.7;
    highFactor = 0.8;
    reasons.push(
      "Large selected-roof capacity: allow more reduction for access routes, setbacks, obstructions and practical layout choices."
    );
  } else if (panels >= 18) {
    profile = "domestic_main_roof_capacity";
    lowFactor = 0.68;
    expectedFactor = 0.74;
    highFactor = 0.84;
    reasons.push(
      "Domestic-sized selected-roof capacity: Google roof capacity is treated as an upper bound before setbacks and obstructions."
    );
  } else if (panels >= 12) {
    profile = "medium_roof_capacity";
    lowFactor = 0.75;
    expectedFactor = 0.82;
    highFactor = 0.92;
    reasons.push(
      "Medium selected-roof capacity: apply a moderate practical layout reduction."
    );
  } else {
    profile = "small_single_roof_capacity";
    lowFactor = 0.82;
    expectedFactor = 0.9;
    highFactor = 1.0;
    reasons.push(
      "Small selected-roof capacity: Google panel count is usually closer to the practical installable count."
    );
  }

  if (source === "max_config_recommended_segment_sum") {
    reasons.push(
      "Recommended capacity was derived by summing selected segments from Google's max config because no exact clean Google config used only the selected roof spaces."
    );
  }

  return {
    profile,
    lowFactor,
    expectedFactor,
    highFactor,
    reasons,
  };
}

function estimateAnnualFromPanelCount(capacityAnnualKwh, capacityPanels, panels) {
  const annual = numberOrNull(capacityAnnualKwh);
  const capacity = numberOrNull(capacityPanels);
  const targetPanels = numberOrNull(panels);

  if (annual === null || capacity === null || capacity <= 0 || targetPanels === null) {
    return null;
  }

  return round1((annual * targetPanels) / capacity);
}

function scoreConfidence({ selector, capacityPanels, lowPanels, highPanels }) {
  let score = 80;
  const reasons = [];

  const source = selector?.recommendedConfig?.source;
  const strategy = selector?.strategy;
  const optionalCount = Array.isArray(selector?.optionalSegmentIndexes)
    ? selector.optionalSegmentIndexes.length
    : 0;

  if (source === "max_config_recommended_segment_sum") {
    score -= 15;
    reasons.push("Capacity is based on a selected-segment sum rather than an exact Google config.");
  }

  if (strategy === "main_roof_pair") {
    score += 5;
    reasons.push("Main roof pair was detected.");
  }

  if (optionalCount > 0) {
    score -= 8;
    reasons.push("There are optional roof segments that could change the final design.");
  }

  if (capacityPanels >= 70) {
    score -= 10;
    reasons.push("Large roof capacity has more layout uncertainty.");
  }

  const rangeWidth = numberOrNull(highPanels) - numberOrNull(lowPanels);

  if (rangeWidth >= 12) {
    score -= 10;
    reasons.push("Panel range is wide.");
  } else if (rangeWidth <= 3) {
    score += 5;
    reasons.push("Panel range is narrow.");
  }

  score = clamp(score, 20, 95);

  let level = "low";
  if (score >= 75) {
    level = "high";
  } else if (score >= 55) {
    level = "medium";
  }

  return {
    level,
    score,
    reasons,
  };
}

function buildPracticalPanelEstimate(segmentSelectorAudit = {}) {
  const selector = segmentSelectorAudit?.firstBuilding;

  if (!selector?.recommendedConfig) {
    return {
      source: "zeyzer_practical_panel_estimate_v1",
      status: "no_selected_roof_capacity",
      capacity: null,
      practicalPanels: null,
      practicalAnnualKwh: null,
      confidence: {
        level: "low",
        score: 20,
        reasons: ["No selected roof capacity was available."],
      },
      reasons: ["No selected roof capacity was available."],
    };
  }

  const capacityPanels = numberOrNull(selector.recommendedConfig.panelsCount);
  const capacityAnnualKwh = numberOrNull(
    selector.recommendedConfig.yearlyEnergyDcKwh
  );

  const factors = choosePanelUtilisationFactors(capacityPanels, selector);

  if (
    capacityPanels === null ||
    capacityPanels <= 0 ||
    factors.lowFactor === null ||
    factors.expectedFactor === null ||
    factors.highFactor === null
  ) {
    return {
      source: "zeyzer_practical_panel_estimate_v1",
      status: "insufficient_data",
      capacity: {
        panels: capacityPanels,
        annualKwh: round1(capacityAnnualKwh),
        configSource: selector.recommendedConfig.source || null,
      },
      practicalPanels: null,
      practicalAnnualKwh: null,
      confidence: {
        level: "low",
        score: 20,
        reasons: ["Insufficient selected-roof capacity data."],
      },
      reasons: factors.reasons,
    };
  }

  const lowPanels = Math.max(1, Math.floor(capacityPanels * factors.lowFactor));
  const expectedPanels = clamp(
    Math.round(capacityPanels * factors.expectedFactor),
    lowPanels,
    capacityPanels
  );
  const highPanels = clamp(
    Math.ceil(capacityPanels * factors.highFactor),
    expectedPanels,
    capacityPanels
  );

  const confidence = scoreConfidence({
    selector,
    capacityPanels,
    lowPanels,
    highPanels,
  });

  return {
    source: "zeyzer_practical_panel_estimate_v1",
    status: "complete",

    capacity: {
      panels: capacityPanels,
      annualKwh: round1(capacityAnnualKwh),
      configSource: selector.recommendedConfig.source || null,
      selectedSegmentIndexes: selector.recommendedSegmentIndexes || [],
      optionalSegmentIndexes: selector.optionalSegmentIndexes || [],
      excludedSegmentIndexes: selector.excludedSegmentIndexes || [],
      selectorStrategy: selector.strategy || null,
    },

    utilisationFactors: {
      profile: factors.profile,
      lowFactor: factors.lowFactor,
      expectedFactor: factors.expectedFactor,
      highFactor: factors.highFactor,
    },

    practicalPanels: {
      low: lowPanels,
      expected: expectedPanels,
      high: highPanels,
    },

    practicalAnnualKwh: {
      low: estimateAnnualFromPanelCount(
        capacityAnnualKwh,
        capacityPanels,
        lowPanels
      ),
      expected: estimateAnnualFromPanelCount(
        capacityAnnualKwh,
        capacityPanels,
        expectedPanels
      ),
      high: estimateAnnualFromPanelCount(
        capacityAnnualKwh,
        capacityPanels,
        highPanels
      ),
    },

    confidence,
    reasons: factors.reasons,
  };
}

module.exports = {
  buildPracticalPanelEstimate,
};
