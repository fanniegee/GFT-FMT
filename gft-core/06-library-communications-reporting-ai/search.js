// GFT Core — search boundary.
export function searchRecords(records=[],term=""){const q=String(term).toLowerCase();return records.filter(r=>JSON.stringify(r).toLowerCase().includes(q))}
