// GFT Core — lineage engine boundary.
export function lineageKey(record){return record?.lineageId||record?.systemId||null}
export function getParentId(record){return record?.parentId||null}
export function isDirectParent(child,parent){return !!child?.parentId&&child.parentId===parent?.systemId}
