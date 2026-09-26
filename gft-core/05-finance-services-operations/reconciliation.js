// GFT Core — reconciliation boundary.
export function reconciliationRecord(input={}){return {recordId:input.recordId||crypto.randomUUID(),status:"UNRECONCILED",reference:input.reference||null}}
