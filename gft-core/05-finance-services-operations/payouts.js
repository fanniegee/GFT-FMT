// GFT Core — payout boundary.
export function payoutRequest(input={}){return {payoutId:input.payoutId||crypto.randomUUID(),amount:Number(input.amount||0),reason:input.reason||"",status:"PENDING_REVIEW"}}
