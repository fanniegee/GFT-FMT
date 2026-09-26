// ============================================================
// GUVAZA FAMILY TRUST
// File: guvazaMainTree.js
//
// PURPOSE:
// Main structural/tree representation of the Guvaza family.
//
// IMPORTANT ARCHITECTURE:
// guvazaTree.js = CANONICAL FAMILY DATA
// guvazaMainTree.js = TREE STRUCTURE / VIEW MODEL
//
// This file MUST NOT maintain a second independent family tree.
//
// COLOR CODES ARE PRESERVED:
// RUTAMBO  = GREEN
// VURAYAI  = OCHRE
// SVUSVU   = GOLD
// VAFONJO  = DAUGHTER_BRANCH
// ============================================================

(function () {

  // ----------------------------------------------------------
  // REQUIRED SOURCE
  // ----------------------------------------------------------

  if (typeof guvazaTree === "undefined") {
    throw new Error(
      "guvazaMainTree.js requires guvazaTree.js to be loaded first."
    );
  }

  if (typeof guvazaTreeById === "undefined") {
    throw new Error(
      "guvazaMainTree.js requires guvazaTreeById from guvazaTree.js."
    );
  }


  // ----------------------------------------------------------
  // BASIC LOOKUPS
  // ----------------------------------------------------------

  function getPerson(systemId) {
    return guvazaTreeById[systemId] || null;
  }


  function getChildren(parentId) {
    return guvazaTree.filter(function (person) {
      return person.parentId === parentId;
    });
  }


  function getChildrenIds(parentId) {
    return getChildren(parentId).map(function (person) {
      return person.systemId;
    });
  }


  function getBranchMembers(branch) {
    return guvazaTree.filter(function (person) {
      return person.branch === branch;
    });
  }


  function getWifeMembers(parentId, wifeNo) {
    return getChildren(parentId).filter(function (person) {
      return person.wifeNo === wifeNo;
    });
  }


  // ----------------------------------------------------------
  // ROOT AND PRIMARY BRANCHES
  // ----------------------------------------------------------

  var root = getPerson("GFT-GEN1-01");

  var rutambo = getPerson("GFT-GEN2-01");
  var vurayai = getPerson("GFT-GEN2-02");
  var svusvu = getPerson("GFT-GEN2-03");
  var vaFonjo = getPerson("GFT-GEN2-04");
  var daughter2 = getPerson("GFT-GEN2-05");


  // ----------------------------------------------------------
  // WIFE STRUCTURE
  //
  // Wife numbers are structural:
  // WIFE 1 through WIFE 8.
  //
  // They are NOT globally tied to one wife name.
  // ----------------------------------------------------------

  var VALID_WIFE_NUMBERS = [
    "WIFE 1",
    "WIFE 2",
    "WIFE 3",
    "WIFE 4",
    "WIFE 5",
    "WIFE 6",
    "WIFE 7",
    "WIFE 8"
  ];


  function buildWifeGroups(parentId) {

    return VALID_WIFE_NUMBERS
      .map(function (wifeNo) {

        var members = getWifeMembers(parentId, wifeNo);

        var wifeName = null;

        for (var i = 0; i < members.length; i++) {
          if (members[i].wifeName) {
            wifeName = members[i].wifeName;
            break;
          }
        }

        return {
          wifeNo: wifeNo,
          wifeName: wifeName,
          children: members
        };

      })
      .filter(function (group) {

        return (
          group.children.length > 0 ||
          group.wifeName !== null
        );

      });

  }


  // ----------------------------------------------------------
  // PERSON NODE
  //
  // This is generated from canonical guvazaTree data.
  // No family member is manually recreated here.
  // ----------------------------------------------------------

  function createPersonNode(person) {

    if (!person) {
      return null;
    }

    return {
      systemId: person.systemId,

      name: person.fullName,
      fullName: person.fullName,

      rootSurname: person.rootSurname,
      currentSurname: person.currentSurname,

      gender: person.gender,

      generation: person.generation,
      branch: person.branch,

      parentId: person.parentId,
      parentName: person.parentName,

      grandparentId: person.grandparentId,
      grandparentName: person.grandparentName,

      wifeNo: person.wifeNo,
      wifeName: person.wifeName,

      isPlaceholder: person.isPlaceholder,

      childrenIds: getChildrenIds(person.systemId),

      children: getChildren(person.systemId).map(
        createPersonNode
      )
    };

  }


  // ----------------------------------------------------------
  // RUTAMBO BRANCH
  //
  // COLOR: GREEN
  // ----------------------------------------------------------

  var rutamboBranch = {

    name: rutambo ? rutambo.fullName : "Rutambo",

    systemId: rutambo
      ? rutambo.systemId
      : "GFT-GEN2-01",

    branch: "BRANCH_RUTAMBO",

    color: "GREEN",

    rootSurname: rutambo
      ? rutambo.rootSurname
      : "Guvaza",

    gender: rutambo
      ? rutambo.gender
      : null,

    children: getChildren("GFT-GEN2-01").map(
      createPersonNode
    )

  };


  // ----------------------------------------------------------
  // VURAYAI BRANCH
  //
  // COLOR: OCHRE
  //
  // IMPORTANT:
  // Vurayai now exposes BOTH:
  //   1. wives
  //   2. direct children
  //
  // The children are still sourced exclusively from
  // guvazaTree.js.
  // ----------------------------------------------------------

  var vurayaiChildren = getChildren("GFT-GEN2-02");

  var vurayaiBranch = {

    name: vurayai
      ? vurayai.fullName
      : "Vurayai",

    systemId: vurayai
      ? vurayai.systemId
      : "GFT-GEN2-02",

    branch: "BRANCH_VURAYAI",

    color: "OCHRE",

    rootSurname: vurayai
      ? vurayai.rootSurname
      : "Guvaza",

    gender: vurayai
      ? vurayai.gender
      : null,

    // Direct children of Vurayai
    children: vurayaiChildren.map(
      createPersonNode
    ),

    // Wife-group representation
    wives: buildWifeGroups("GFT-GEN2-02")

  };


  // ----------------------------------------------------------
  // SVUSVU BRANCH
  //
  // COLOR: GOLD
  // ----------------------------------------------------------

  var svusvuBranch = {

    name: svusvu
      ? svusvu.fullName
      : "Svusvu",

    systemId: svusvu
      ? svusvu.systemId
      : "GFT-GEN2-03",

    branch: "BRANCH_SVUSVU",

    color: "GOLD",

    rootSurname: svusvu
      ? svusvu.rootSurname
      : "Guvaza",

    gender: svusvu
      ? svusvu.gender
      : null,

    children: getChildren("GFT-GEN2-03").map(
      createPersonNode
    ),

    wives: buildWifeGroups("GFT-GEN2-03")

  };


  // ----------------------------------------------------------
  // VAFONJO BRANCH
  //
  // COLOR: DAUGHTER_BRANCH
  //
  // VaFonjo is the 4th CHILD, not 4th Daughter.
  // ----------------------------------------------------------

  var vaFonjoBranch = {

    name: vaFonjo
      ? vaFonjo.fullName
      : "VaFonjo",

    systemId: vaFonjo
      ? vaFonjo.systemId
      : "GFT-GEN2-04",

    branch: "BRANCH_VAFONJO",

    order: "4th Child",

    color: "DAUGHTER_BRANCH",

    rootSurname: vaFonjo
      ? vaFonjo.rootSurname
      : "Guvaza",

    gender: vaFonjo
      ? vaFonjo.gender
      : null,

    children: getChildren("GFT-GEN2-04").map(
      createPersonNode
    )

  };


  // ----------------------------------------------------------
  // FIFTH CHILD / DAUGHTER 2
  //
  // Existing branch is preserved.
  // No family data is invented here.
  // ----------------------------------------------------------

  var daughter2Branch = {

    name: daughter2
      ? daughter2.fullName
      : "Daughter 2",

    systemId: daughter2
      ? daughter2.systemId
      : "GFT-GEN2-05",

    branch: "BRANCH_DAUGHTER2",

    rootSurname: daughter2
      ? daughter2.rootSurname
      : "Guvaza",

    gender: daughter2
      ? daughter2.gender
      : null,

    children: getChildren("GFT-GEN2-05").map(
      createPersonNode
    )

  };


  // ----------------------------------------------------------
  // FINAL MAIN TREE
  // ----------------------------------------------------------

  var GUVAZA_MAIN_TREE = {

    root: root
      ? root.fullName
      : "Guvaza",

    rootId: root
      ? root.systemId
      : "GFT-GEN1-01",

    // Automatically reflects the canonical source count.
    total: guvazaTree.length,

    dataSource: "guvazaTree.js",

    canonicalData: true,

    // Only these surname fields are permitted.
    surnameFields: [
      "rootSurname",
      "currentSurname"
    ],

    forbiddenSurnameFields: [
      "secondSurname"
    ],


    // --------------------------------------------------------
    // ADMIN SETTINGS
    // --------------------------------------------------------

    adminSettings: {

      canEditPlaceholder: true,

      rootSurnameLocked: "Guvaza"

    },


    // --------------------------------------------------------
    // PRIMARY FAMILY BRANCHES
    // --------------------------------------------------------

    firstSon: rutamboBranch,

    secondSon: vurayaiBranch,

    thirdSon: svusvuBranch,

    fourthChild: vaFonjoBranch,

    fifthChild: daughter2Branch,


    // --------------------------------------------------------
    // CANONICAL DATA ACCESS
    // --------------------------------------------------------

    members: guvazaTree,

    membersById: guvazaTreeById,


    // --------------------------------------------------------
    // PUBLIC HELPER FUNCTIONS
    // --------------------------------------------------------

    getPerson: getPerson,

    getChildren: getChildren,

    getChildrenIds: getChildrenIds,

    getBranchMembers: getBranchMembers,

    getWifeMembers: getWifeMembers,

    getWifeGroups: buildWifeGroups,

    createPersonNode: createPersonNode,


    // --------------------------------------------------------
    // VALIDATION
    //
    // Uses validateGuvazaTree if guvazaTree.js provides it.
    // --------------------------------------------------------

    validate:
      typeof validateGuvazaTree === "function"
        ? validateGuvazaTree()
        : null

  };


  // ----------------------------------------------------------
  // EXPORT
  // ----------------------------------------------------------

  if (typeof window !== "undefined") {
    window.GUVAZA_MAIN_TREE = GUVAZA_MAIN_TREE;
  }

  if (
    typeof module !== "undefined" &&
    module.exports
  ) {
    module.exports = GUVAZA_MAIN_TREE;
  }

})();