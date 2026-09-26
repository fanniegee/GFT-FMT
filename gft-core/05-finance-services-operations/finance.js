// GFT Core — finance boundary.
export function ledgerEntry(input={}){return {entryId:input.entryId||crypto.randomUUID(),type:input.type||"UNSPECIFIED",amount:Number(input.amount||0),status:"PENDING"}}
