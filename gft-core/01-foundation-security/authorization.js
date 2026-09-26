// GFT Core — authorization engine.
export function hasPermission(subject,permission){
  const p=Array.isArray(subject?.permissions)?subject.permissions:[];
  return p.includes("*")||p.includes(permission)||p.includes(`${permission}:*`);
}
export function requirePermission(subject,permission){if(!hasPermission(subject,permission))throw new Error(`Access denied: ${permission}`);return true;}
