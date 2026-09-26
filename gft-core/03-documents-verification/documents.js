// GFT Core — document engine boundary.
export function documentRecord(input={}){return {documentId:input.documentId||null,type:input.type||null,status:"RECEIVED",uploadedAt:new Date().toISOString()}}
