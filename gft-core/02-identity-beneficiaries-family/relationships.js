// GFT Core — relationship engine boundary.
export function relationship(a,b){if(!a||!b)return null;if(a.parentId===b.systemId)return "child";if(b.parentId===a.systemId)return "parent";return null}
