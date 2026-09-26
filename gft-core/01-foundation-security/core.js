// GFT Core — central gateway.
// Front ends communicate through this gateway.
export const GFTCore = {
  version: "1.0.0",
  group: "foundation-security",
  status: "prototype",
};
if (typeof window !== "undefined") window.GFTCore = GFTCore;
