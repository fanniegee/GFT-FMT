// GFT Core — transaction boundary.
export function transaction(input={}){return {transactionId:input.transactionId||crypto.randomUUID(),type:input.type||"UNSPECIFIED",status:"PENDING",createdAt:new Date().toISOString()}}
