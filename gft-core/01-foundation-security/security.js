// GFT Core — security helpers.
export function createSecurityEvent(type,details={}){return {type,details,timestamp:new Date().toISOString()};}
export function safeJsonParse(value,fallback=null){try{return JSON.parse(value)}catch{return fallback}}
