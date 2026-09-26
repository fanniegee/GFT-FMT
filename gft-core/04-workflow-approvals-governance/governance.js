// GFT Core — governance/authority boundary.
export function authoritySnapshot(admin={}){return {status:admin.status||"UNKNOWN",role:admin.role||null,modules:admin.deployment?.modules||[],permissions:admin.deployment?.permissions||[],approvalLevel:admin.deployment?.approvalLevel||null,scope:admin.deployment?.scope||null}}
