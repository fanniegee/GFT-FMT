// GFT Core — canonical family/trust rule boundary.
export const FAMILY_RULES = {
  repeatedNamesDoNotEstablishIdentity:true,
  identityKeys:["systemId","parentId"],
  femaleGraceAppliesToBiologicalChildrenOfGuvazaDaughters:true
};
export function getFamilyRules(){return {...FAMILY_RULES}}
