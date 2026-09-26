// GFT Core — audit boundary.
// Prototype only; production audit must be server-side and immutable.
const KEY="gft_core_audit";
export function recordAudit(event){const a=loadAudit();const e={...event,timestamp:event.timestamp||new Date().toISOString()};a.push(e);localStorage.setItem(KEY,JSON.stringify(a));return e;}
export function loadAudit(){try{const a=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(a)?a:[]}catch{return[]}}
