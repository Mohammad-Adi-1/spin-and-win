/* ══════════════════════════════════════════════════
   VELOX CONFIGURATION
   ══════════════════════════════════════════════════ */

const CONFIG = {
  // Treasury wallet (Your Trust Wallet address)
  TREASURY_ADDRESS: "UQBQa7StXjJcs43AJyTlW7-g-AZrihVW2oEsN0OPDiwuiX1e",

  // Supabase Credentials
  SUPABASE_URL: "https://bfvhqcjvvzonizxnswfw.supabase.co",
  SUPABASE_KEY: "sb_publishable_OWFtqWLbRVarLjOxupUjhQ_C3Hbreur",

  // Game Settings
  PLATFORM_FEE: 0.05, // 5%
  MIN_DEPOSIT: 1,     // 1 TON
  MIN_WITHDRAW: 5,    // 5 TON
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
} else {
  window.CONFIG = CONFIG;
}
