// GFT Core — communications boundary.
export function messageRecord(input={}){return {messageId:input.messageId||crypto.randomUUID(),to:input.to||null,subject:input.subject||"",body:input.body||"",status:"QUEUED"}}
