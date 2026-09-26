// GFT Core — reporting boundary.
export function reportEnvelope(type,data){return {type,data,generatedAt:new Date().toISOString()}}
