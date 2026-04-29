// ====== POSTCODE HELPERS ======
function validateAndNormalisePostcode(rawPostcode) {
  if (!rawPostcode || typeof rawPostcode !== "string") {
    throw new Error("Postcode is required.");
  }

  const cleaned = rawPostcode.toUpperCase().replace(/\s+/g, "");
  if (cleaned.length < 5) throw new Error("Postcode looks too short.");

  const formatted = `${cleaned.slice(0, -3)} ${cleaned.slice(-3)}`;
  const re = /^[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}$/;

  if (!re.test(formatted)) throw new Error("Postcode format is not recognised.");
  return formatted;
}

function getPostcodeArea(postcode) {
  if (!postcode) return null;
  const outward = postcode.trim().toUpperCase().split(" ")[0];
  const match = outward.match(/^[A-Z]{1,2}/);
  return match ? match[0] : null;
}

module.exports = {
  validateAndNormalisePostcode,
  getPostcodeArea,
};