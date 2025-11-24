const { BRAND_FROM_NAME } = require("../config/constants");

// Build From address that displays only the brand name
// The email address is still required for routing but won't be prominently displayed
const buildFromAddress = (email) => {
  const displayName = BRAND_FROM_NAME || "Yellowmatics.ai";
  // Format: "Display Name" <email> - Most email clients will show only "Display Name"
  return `"${displayName}" <${email}>`;
};

module.exports = {
  buildFromAddress,
};

