// GFT Core — AI assistant boundary.
// AI may explain/query authorised engines; it does not grant authority or bypass rules.
export function assistantContext(input={}){return {question:input.question||"",authorizedOnly:true,canGrantAuthority:false,canApproveMoney:false}}
