// ============================================================
// GUVAZA FAMILY TRUST - PERMANENT CORE RULES
// File: trustRules.js
// Founder controls final FOUNDER_VERIFIED status.
// System Date: 2026
// ============================================================

const TRUST_RULES = {

  // ----------------------------------------------------------
  // ROOT
  // ----------------------------------------------------------
  root: {
    name: "Guvaza",
    systemId: "GFT-GEN1-01",
    rootSurname: "Guvaza"
  },


  // ----------------------------------------------------------
  // MAIN FAMILY BRANCHES
  // ----------------------------------------------------------
  branches: {

    RUTAMBO: {
      order: "1st Son",
      color: "GREEN",
      founder: "Rutambo"
    },

    VURAYAI: {
      order: "2nd Son",
      color: "OCHRE",
      founder: "Vurayai"
    },

    SVUSVU: {
      order: "3rd Son",
      color: "GOLD",
      founder: "Svusvu"
    },

    VAFONJO: {
      order: "4th Child",
      color: "DAUGHTER_BRANCH",
      founder: "Guvaza"
    }

  },


  // ----------------------------------------------------------
  // VERIFICATION FLOW
  // ----------------------------------------------------------
  verificationFlow: [
    "LINEAGE_CONFIRMED",
    "PENDING_VERIFICATION",
    "AUTO_VERIFIED",
    "FOUNDER_VERIFIED"
  ],


  // ----------------------------------------------------------
  // GENDER
  // ----------------------------------------------------------
  gender: {
    required: true,

    values: [
      "MALE",
      "FEMALE"
    ]
  },


  // ----------------------------------------------------------
  // FEMALE GRACE
  //
  // Female grace is determined by actual biological lineage
  // and gender — NOT simply by generation number.
  //
  // A Guvaza daughter may register.
  // The biological child of a Guvaza daughter may register.
  // Female grace ends there.
  // ----------------------------------------------------------
  femaleGrace: {

    enabled: true,

    description:
      "Female grace permits registration through Guvaza daughters only to their direct biological children.",

    directGuvazaDaughter: {
      canRegister: true
    },

    childOfGuvazaDaughter: {
      canRegister: true,
      canReceivePayout: false,
      requiresFounderApproval: true
    },

    descendantBeyondDirectChild: {
      canRegister: false,
      blocked: true,
      reason:
        "Female grace ends with the direct biological children of Guvaza daughters."
    },

    registrationRequirement: {
      biologicalRelationshipRequired: true,
      genderRequired: true,
      generationNumberAloneIsNotSufficient: true
    },

    grandparentRule: {
      acceptableGrandparentGender: "MALE",
      femaleGrandparentIsNotAcceptableForNewFemaleGraceRegistration: true
    },

    example: {
      allowed: {
        lineage:
          "Vurayai Guvaza -> Serina Guvaza -> Florence Mahachi",
        reason:
          "Florence is the direct biological child of Guvaza daughter Serina, whose Guvaza ancestral line is through male Vurayai."
      },

      blocked: {
        lineage:
          "Vurayai Guvaza -> Serina Guvaza -> Florence Mahachi -> Chipo Muzhara",
        reason:
          "Chipo is beyond the direct-child limit of female grace."
      }
    }
  },


  // ----------------------------------------------------------
  // SURNAME / BLOODLINE LOGIC
  // ----------------------------------------------------------
  surnameLogic: {

    rootSurnameField: "rootSurname",

    currentSurnameField: "currentSurname",

    forbiddenSurnameField: "secondSurname",

    bloodLineField: "parentId",

    rule:
      "Root surname records ancestral Guvaza lineage. Current surname records the surname presently used. Current surname does not by itself determine Guvaza lineage.",

    marriedGuvazaDaughter:
      "A married Guvaza daughter remains connected to the Guvaza lineage.",

    childOfGuvazaDaughter:
      "A child may carry the father's or current family surname while remaining connected to Guvaza lineage when the female-grace registration rule is satisfied."
  },


  // ----------------------------------------------------------
  // NAME / PARENTHESES INTERPRETATION
  // ----------------------------------------------------------
  nameInterpretation: {

    parentIdentifyingParentheses: {
      examples: [
        "Zekia Guvaza (Dzikamai)",
        "Mary Guvaza (Zekia)"
      ],

      meaning:
        "The name in parentheses identifies the parent/father."
    },

    personalSecondName: {
      examples: [
        "Dzikamai (Leonard) Guvaza",
        "Masara (Edward) Guvaza"
      ],

      meaning:
        "The name in parentheses is the person's own second/personal name."
    },

    rule:
      "The system must distinguish parent-identifying notation from a person's own second name."
  },


  // ----------------------------------------------------------
  // LINEAGE REGISTRATION
  // ----------------------------------------------------------
  lineage: {

    requireParentFullName: true,

    requireGrandparentFullName: true,

    parentMustExist: true,

    acceptedParentSources: [
      "FIXED_FAMILY_TREE",
      "VERIFIED_REGISTRATION"
    ],

    deriveGrandparentFromVerifiedParent: true,

    applicantClaimedGrandparentMustMatchDerivedGrandparent: true,

    noRootFallback: true,

    formattingNormalization: [
      "TRIM_WHITESPACE",
      "CASE_NORMALIZATION"
    ],

    silentSpellingCorrection: false,

    mismatchStatus: "LINEAGE_REVIEW_REQUIRED",

    revealCorrectGrandparentAfterMismatch: false,

    rule:
      "The applicant's claimed grandparent must correspond to the actual grandparent derived from the verified parent record."
  },


  // ----------------------------------------------------------
  // IDENTITY EXCEPTION
  //
  // ONLY the documented Zekia/Heskia discrepancy may be
  // silently resolved.
  // ----------------------------------------------------------
  identityExceptions: {

    zekiaHeskia: {

      enabled: true,

      silentResolutionAllowed: true,

      appliesOnly:
        "The documented Zekia/Heskia identity discrepancy associated with GFT-GEN3-010.",

      affectedSystemId:
        "GFT-GEN3-010",

      familyName:
        "Zekia Guvaza",

      documentNameException:
        "Heskia",

      relationshipClarification:
        "Zekia/Heskia Guvaza is the uncle of Zekia Guvaza (Dzikamai).",

      separateIndividual: {

        systemId:
          "GFT-GEN4-054",

        name:
          "Zekia Guvaza (Dzikamai)",

        rule:
          "This is a separate individual and must not be merged with GFT-GEN3-010."
      },

      notAGeneralFuzzyMatchRule: true
    }
  },


  // ----------------------------------------------------------
  // SPELLING RULES
  // ----------------------------------------------------------
  spelling: {

    normalFormattingNormalizationAllowed: true,

    generalSilentSpellingCorrection: false,

    wrongApplicantSpellingRequiresFounderOrAdminVerification: true,

    familyTreeCorrectionsMayBePerformedAdministratively: true,

    onlySilentIdentityException:
      "GFT-GEN3-010 Zekia/Heskia discrepancy",

    doNotRevealCorrectAnswerAfterFailedVerification: true
  },


  // ----------------------------------------------------------
  // WIFE STRUCTURE
  // ----------------------------------------------------------
  wifeCheck: {

    maxWives: 8,

    dropdown: [
      "WIFE 1",
      "WIFE 2",
      "WIFE 3",
      "WIFE 4",
      "WIFE 5",
      "WIFE 6",
      "WIFE 7",
      "WIFE 8"
    ],

    manualSelectionRequired: true,

    monogamousFamilyRule:
      "A monogamous family structurally uses WIFE 1, but the applicant must manually select WIFE 1.",

    automaticWifeOneAssignment: false,

    wifeNumberIsStructural: true,

    wifeNumberIsBranchSpecific: true,

    wifeNumberIsNotGloballyTiedToOneName: true,

    knownWifeNamesMayBeDisplayed: true,

    unknownWifeNamesRemainUnknown: true,

    neverInventUnknownWifeName: true,

    founderAdminMayEditUnknownWifeName: true,

    attempts: 2,

    firstWrongAttempt:
      "ONE_REMAINING_ATTEMPT",

    secondWrongAttempt:
      "FROZEN_WAITING_FOUNDER_APPROVAL",

    thirdAttemptAllowed: false,

    revealCorrectAnswerAfterFailure: false,

    historicalWifeClans: [
      "Vazvichaipwi",
      "Punha Gwendere",
      "Vamasorongose",
      "Martha Gwendere"
    ]
  },


  // ----------------------------------------------------------
  // REGISTRATION AGE / DOCUMENT RULES
  // ----------------------------------------------------------
  registration: {

    minAgeDays: 1,

    registrationFromOneDayOld: true,

    birthCertAllowed: true,

    idRequiredAfter:
      "16 years + 1 day",

    under16: {
      document: "Birth Certificate",
      needsGuardian: true
    },

    over16: {
      document: "National ID",
      needsGuardian: false
    },

    genderRequired: true
  },


  // ----------------------------------------------------------
  // ZIMBABWE NATIONAL ID VERIFICATION
  //
  // Identity verification is separate from lineage verification.
  // A valid ID does NOT prove Guvaza lineage.
  // ----------------------------------------------------------
  identityVerification: {

    separateFromLineage: true,

    stages: [
      "FORMAT_VALIDATION",
      "DOCUMENT_INFORMATION_CONSISTENCY",
      "AUTHENTICITY_OR_TAMPER_CHECK_WHERE_SUPPORTED",
      "AUTHORIZED_EXTERNAL_VERIFICATION_WHERE_AVAILABLE",
      "APPLICANT_ID_CONSISTENCY"
    ],

    validIdDoesNotProveLineage: true
  },


  // ----------------------------------------------------------
  // EMAIL VERIFICATION
  // ----------------------------------------------------------
  emailVerification: {

    compulsoryForPhysicalRegistration: true,

    usernameOptional: true,

    otpRequired: true,

    otpLifetimeSeconds: 180,

    storeOtpAsHash: true,

    storePlainOtp: false,

    rateLimitAttempts: true,

    rateLimitResends: true,

    insecureFrontendStorage: false,

    emailCanBeLoginIdentifier: true,

    usernameCanBeLoginIdentifier: true,

    emailOwnershipDoesNotProveLineage: true,

    emailChangeRequiresControlledVerification: true,

    maintainEmailHistory: true
  },


  // ----------------------------------------------------------
  // GFT IDENTIFICATION NUMBER
  // ----------------------------------------------------------
  gftId: {

    format: "GFT-GENX-XXX",

    existingFixedMembersKeepExistingIds: true,

    newPersonReceivesPermanentNewId: true,

    idBasedOnDateOfBirth: false,

    dateOfBirthMayBeUsedForSorting: true,

    dateOfBirthMayBeUsedForBirthOrder: true,

    dateOfBirthMayBeUsedForAge: true,

    existingIdsMayNotBeRenumbered: true,

    numericSortingRequired: true,

    zeroPaddingRequired: true
  },


  // ----------------------------------------------------------
  // DUPLICATE PROTECTION
  // ----------------------------------------------------------
  duplicateProtection: {

    checkFixedFamilyTree: true,

    checkVerifiedRegistrations: true,

    nameOnlyMatchingIsInsufficient: true,

    sameNameCanRepresentDifferentPeople: true,

    requireIdentityAndLineageContext: true
  },


  // ----------------------------------------------------------
  // FOUNDER / ADMIN VERIFICATION
  // ----------------------------------------------------------
  founderAdminVerification: {

    allowedMethods: [
      "PHYSICAL_RECOGNITION",
      "PARENT_CONFIRMED",
      "DOCUMENTS_PRESENTED"
    ],

    parentContactMayBeUsed: true,

    parentConfirmationDoesNotAutomaticallyActivate: true,

    founderAdminFinalApprovalRequired: true,

    auditRequired: true,

    auditFields: [
      "applicant",
      "method",
      "verifier",
      "datetime",
      "reason",
      "notes"
    ]
  },


  // ----------------------------------------------------------
  // PARENT CONFIRMATION
  // ----------------------------------------------------------
  parentConfirmation: {

    secureOneTimeEmailLink: true,

    cryptographicallyRandomToken: true,

    caseSpecificToken: true,

    expiringToken: true,

    singleUseToken: true,

    storeTokenHash: true,

    results: [
      "PARENT_CONFIRMED",
      "PARENT_CONFIRMATION_DENIED"
    ],

    parentConfirmationIsNotFounderApproval: true,

    preserveAuditEvidence: true
  },


  // ----------------------------------------------------------
  // PAYOUT
  // ----------------------------------------------------------
  payout: {

    eligibleOnlyIf:
      "FOUNDER_VERIFIED",

    registrationDoesNotGrantPayout: true,

    lineageConfirmedDoesNotGrantPayout: true,

    pendingVerificationDoesNotGrantPayout: true,

    underReview: {
      walletEligible: false,
      payoutEligible: false
    },

    explicitFounderApprovalRequired: true
  },


  // ----------------------------------------------------------
  // PLACEHOLDERS
  // ----------------------------------------------------------
  placeholders: {

    explicitFlagRequired: true,

    field: "isPlaceholder",

    automaticallyVerified: false,

    founderAdminCanReplace: true,

    examples: [
      "Girls 4/5",
      "Unknown",
      "Daughter records"
    ]
  },


  // ----------------------------------------------------------
  // CANONICAL BENEFICIARY RECORD
  //
  // register.html becomes the registration contract.
  // Other portals consume this canonical structure.
  // ----------------------------------------------------------
  canonicalBeneficiaryRecord: {

    fields: [
      "systemId",
      "fullName",
      "dateOfBirth",
      "gender",
      "rootSurname",
      "currentSurname",
      "parentId",
      "parentName",
      "grandparentId",
      "grandparentName",
      "generation",
      "branch",
      "wifeNo",
      "wifeName",
      "email",
      "emailVerified",
      "lineageStatus",
      "identityStatus",
      "founderVerificationStatus",
      "beneficiaryStatus",
      "walletEligible",
      "payoutEligible"
    ],

    source:
      "register.html",

    downstreamPortalsMustConsumeCanonicalRecord: true
  },


  // ----------------------------------------------------------
  // PORTAL INTEGRATION
  // ----------------------------------------------------------
  portalIntegration: {

    beneficiaryDrilldown: {
      file: "beneficiary-drilldown.htm",
      useParentIdForChildren: true,
      useCanonicalBeneficiaryRecord: true
    },

    myDirectLineage: {
      file: "my-direct-lineage.html",
      deriveAncestryThroughParentIds: true,
      deriveToRoot: true,
      useCanonicalBeneficiaryRecord: true
    },

    admin: {
      file: "admin.html",
      useCanonicalBeneficiaryRecord: true,
      ascendingNumericGftOrder: true,
      zeroPaddingRequired: true
    },

    founder: {
      file: "founder.html",
      useCanonicalBeneficiaryRecord: true,

      separateInternalRules: true,

      founderInternalRulesMustNotBeMergedIntoTrustRules: true
    }
  },


  // ----------------------------------------------------------
  // SECURITY
  // ----------------------------------------------------------
  security: {

    correctGrandparentMustNeverBeRevealedAfterMismatch: true,

    correctWifeAnswerMustNeverBeRevealedAfterFailure: true,

    identityVerificationIndependentFromLineage: true,

    emailVerificationIndependentFromLineage: true,

    registrationDoesNotEqualPayout: true,

    failedVerificationMustNotEnableBacktracking: true,

    auditSensitiveActions: true
  },


  // ----------------------------------------------------------
  // HELPER FUNCTIONS
  // ----------------------------------------------------------

  isPlaceholder: function(person) {
    return person && person.isPlaceholder === true;
  },


  canRegisterChildren: function(person) {

    if (!person) {
      return false;
    }

    if (person.femaleGraceLevel >= 2) {
      return false;
    }

    return true;
  },


  canReceivePayout: function(person) {

    if (!person) {
      return false;
    }

    return (
      person.founderVerificationStatus === "FOUNDER_VERIFIED" &&
      person.beneficiaryStatus === "FOUNDER_VERIFIED" &&
      person.walletEligible === true &&
      person.payoutEligible === true
    );
  },


  // ----------------------------------------------------------
  // ZEKIA / HESKIA SILENT RESOLUTION
  // ONLY GFT-GEN3-010 IS ALLOWED
  // ----------------------------------------------------------
  canSilentlyResolveSpelling: function({
    systemId,
    submittedName,
    knownName
  }) {

    if (systemId !== "GFT-GEN3-010") {
      return false;
    }

    if (!submittedName || !knownName) {
      return false;
    }

    const submitted = String(submittedName)
      .trim()
      .toUpperCase();

    const known = String(knownName)
      .trim()
      .toUpperCase();

    return (
      (submitted === "ZEKIA GUVAZA" && known === "HESKIA GUVAZA") ||
      (submitted === "HESKIA GUVAZA" && known === "ZEKIA GUVAZA")
    );
  },


  requiresFounderSpellingVerification: function({
    systemId,
    submittedName,
    knownName
  }) {

    return !this.canSilentlyResolveSpelling({
      systemId,
      submittedName,
      knownName
    });
  },


  // ----------------------------------------------------------
  // WIFE CHOICE VALIDATION
  // ----------------------------------------------------------
  isValidWifeChoice: function(wifeNo) {

    const validChoices = [
      "WIFE 1",
      "WIFE 2",
      "WIFE 3",
      "WIFE 4",
      "WIFE 5",
      "WIFE 6",
      "WIFE 7",
      "WIFE 8"
    ];

    return validChoices.includes(wifeNo);
  },


  // ----------------------------------------------------------
  // PAYOUT ELIGIBILITY HELPER
  // ----------------------------------------------------------
  isPayoutEligible: function(person) {

    if (!person) {
      return false;
    }

    return (
      person.founderVerificationStatus === "FOUNDER_VERIFIED" &&
      person.beneficiaryStatus === "FOUNDER_VERIFIED" &&
      person.walletEligible === true &&
      person.payoutEligible === true
    );
  }

};


// ============================================================
// EXPORT
// ============================================================

// Browser
if (typeof window !== "undefined") {
  window.TRUST_RULES = TRUST_RULES;
}

// Node / CommonJS
if (typeof module !== "undefined" && module.exports) {
  module.exports = TRUST_RULES;
}