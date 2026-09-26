// GFT Core — master gateway.
// This file is the single front-end entry point. Individual group engines
// remain separate modules and can be wired into this gateway incrementally.
export const GFT_CORE = {
  version: "1.0.0",
  groups: [
    "foundation-security",
    "identity-beneficiaries-family",
    "documents-verification",
    "workflow-approvals-governance",
    "finance-services-operations",
    "library-communications-reporting-ai"
  ]
};
if (typeof window !== "undefined") window.GFT_CORE = GFT_CORE;
