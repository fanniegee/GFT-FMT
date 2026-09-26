// GFT Core — Trust Library boundary.
export function libraryAccess(record){return {classification:record?.classification||"RESTRICTED",allowed:!!record?.allowed}}
