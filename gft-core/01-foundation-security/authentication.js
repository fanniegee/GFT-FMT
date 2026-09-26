// GFT Core — authentication boundary.
// Prototype only; production authentication must be server-side.
const KEY="gft_core_session";
export function startSession(session){ const v={...session,authenticatedAt:new Date().toISOString()}; localStorage.setItem(KEY,JSON.stringify(v)); return v; }
export function getSession(){ try{return JSON.parse(localStorage.getItem(KEY)||"null")}catch{return null} }
export function endSession(){localStorage.removeItem(KEY)}
export function isAuthenticated(){return !!getSession()}
