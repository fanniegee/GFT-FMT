// GFT Core — identity engine.
export function normalizeIdentity(input={}) {
  return {
    systemId:String(input.systemId ?? input.membership ?? "").trim(),
    fullName:String(input.fullName ?? "").trim(),
    username:String(input.username ?? "").trim(),
    phone:String(input.phone ?? "").trim(),
    idNumber:String(input.idNumber ?? "").trim()
  };
}
export function identityMatches(a,b){ const x=normalizeIdentity(a),y=normalizeIdentity(b); return !!x.systemId && x.systemId===y.systemId; }
