// GFT Core — approval engine boundary.
export function approvalRequest(action,subject){return {action,subject,status:"PENDING",requestedAt:new Date().toISOString()}}
