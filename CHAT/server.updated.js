
/*
  server.updated.js
  =================
  Add this logic to your existing server.js
  so the daily usage profile is sent to the frontend.
*/

/* -------------------------------------------
   Helper: build daily usage profile
-------------------------------------------- */

function buildDailyUsageProfile(annualKWh, occupancyProfile) {
  const fractions = getDailyProfileFractions(occupancyProfile);

  return {
    labels: [
      "00:00","02:00","04:00","06:00","08:00","10:00",
      "12:00","14:00","16:00","18:00","20:00","22:00"
    ],
    fractions
  };
}

/* -------------------------------------------
   When assembling the quote object, add:
-------------------------------------------- */

quote.dailyUsageProfile = buildDailyUsageProfile(
  quote.assumedAnnualConsumptionKWh,
  form.occupancyProfile
);
