// GFT Core — services boundary.
export function serviceRequest(serviceId,subject,details={}){return {requestId:crypto.randomUUID(),serviceId,subject,details,status:"PENDING"}}
