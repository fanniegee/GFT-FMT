// GFT Core — configuration boundary.
export const GFT_CONFIG = { version: "1.0.0", environment: "prototype" };
export function getConfig(){ return structuredClone ? structuredClone(GFT_CONFIG) : {...GFT_CONFIG}; }
export function setConfigValue(key,value){ if(!key) throw new Error("Invalid configuration key"); GFT_CONFIG[key]=value; return value; }
