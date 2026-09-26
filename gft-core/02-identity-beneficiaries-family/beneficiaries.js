// GFT Core — beneficiary engine boundary.
export function beneficiaryKey(record){return record?.systemId||record?.membership||null}
export function isBeneficiary(record){return !!beneficiaryKey(record)}
