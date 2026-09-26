// GFT Core — correction/review boundary.
export function createCorrectionRequest(target,changes,reason=""){return {target,changes,reason,status:"PENDING_REVIEW",createdAt:new Date().toISOString()}}
