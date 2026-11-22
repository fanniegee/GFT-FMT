/* ============================================================
   GFT PORTAL DATA
   Beneficiary Portal content + Trust Library access model
   Save/rename this file to: portalData.js

   IMPORTANT:
   - This file contains portal configuration/content metadata.
   - It does NOT contain private beneficiary records.
   - It does NOT contain actual document files.
   - Personal entitlements must ultimately be enforced server-side.
   ============================================================ */

const GFT_PORTAL_DATA = {

  /* ==========================================================
     PORTAL COLOUR SYSTEM
     Each portal has its own visual identity.
     ========================================================== */
  portalColors: {
    transfers: { name: "Transfer", primary: "#164e43", secondary: "#0f766e", accent: "#99d8c8", background: "#eaf9f3" },
    notifications: {
      name: "Notifications",
      primary: "#7c2d12",
      secondary: "#f97316",
      accent: "#fed7aa",
      background: "#fff7ed",
      icon: "notifications"
    },

    security: {
      name: "Security",
      primary: "#172554",
      secondary: "#2563eb",
      accent: "#bfdbfe",
      background: "#eff6ff",
      icon: "security"
    },

    documents: {
      name: "My Documents",
      primary: "#334155",
      secondary: "#64748b",
      accent: "#cbd5e1",
      background: "#f8fafc",
      icon: "folder_copy"
    },

    benefits: {
      name: "Benefits",
      primary: "#14532d",
      secondary: "#16a34a",
      accent: "#bbf7d0",
      background: "#f0fdf4",
      icon: "card_giftcard"
    },

    accounts: {
      name: "Accounts",
      primary: "#0c4a6e",
      secondary: "#0284c7",
      accent: "#bae6fd",
      background: "#f0f9ff",
      icon: "account_balance_wallet"
    },

    companies: {
      name: "Companies",
      primary: "#3b0764",
      secondary: "#7e22ce",
      accent: "#e9d5ff",
      background: "#faf5ff",
      icon: "business"
    },

    jobs: {
      name: "Jobs",
      primary: "#713f12",
      secondary: "#ca8a04",
      accent: "#fef08a",
      background: "#fefce8",
      icon: "work"
    },

    profile: {
      name: "Profile",
      primary: "#831843",
      secondary: "#db2777",
      accent: "#fbcfe8",
      background: "#fdf2f8",
      icon: "person"
    },

    trustLibrary: {
      name: "Trust Library",
      primary: "#071d5c",
      secondary: "#8b173b",
      accent: "#d4af37",
      background: "#f8fafc",
      icon: "local_library"
    }
  },


  /* ==========================================================
     1. NOTIFICATIONS
     ========================================================== */
  notifications: {
    title: "Notifications",
    introduction: "Important Trust messages, service notices and account alerts.",
    emptyState: "No personal notifications yet.",
    publicNotices: [
      {
        id: "NOT-001",
        type: "GENERAL",
        title: "Welcome to the Guvaza Family Trust Portal",
        message: "The portal provides access to Trust information, beneficiary services, documents, benefits, accounts, companies and employment opportunities.",
        date: "2026-09-01",
        priority: "normal"
      },
      {
        id: "NOT-002",
        type: "REGISTRATION",
        title: "Beneficiary Registration",
        message: "Complete beneficiary registration and verification before personal account services become available.",
        date: "2026-09-01",
        priority: "important"
      },
      {
        id: "NOT-003",
        type: "SECURITY",
        title: "Protect Your Account",
        message: "Never share your password, verification code or security credentials with another person.",
        date: "2026-09-01",
        priority: "important"
      }
    ],
    personalNotificationTypes: [
      "REGISTRATION_UPDATE",
      "DOCUMENT_UPDATE",
      "BENEFIT_UPDATE",
      "PAYOUT_UPDATE",
      "CASHOUT_UPDATE",
      "JOB_APPLICATION_UPDATE",
      "SECURITY_ALERT",
      "TRUST_MESSAGE"
    ]
  },


  /* ==========================================================
     2. SECURITY
     ========================================================== */
  security: {
    title: "Security",
    introduction: "Security controls protecting beneficiary accounts and sensitive Trust services.",
    beforeRegistration: "General security information is available before registration. Personal security controls become available after account activation.",
    features: [
      {
        id: "SEC-001",
        title: "Secure Sign-in",
        icon: "login",
        description: "Access your beneficiary account through authorized sign-in credentials."
      },
      {
        id: "SEC-002",
        title: "Biometric / Passkey Verification",
        icon: "fingerprint",
        description: "Sensitive actions may require device biometric or passkey authentication."
      },
      {
        id: "SEC-003",
        title: "Sensitive Card Protection",
        icon: "credit_card",
        description: "Protected card information should only be displayed after successful security verification."
      },
      {
        id: "SEC-004",
        title: "Payout Protection",
        icon: "payments",
        description: "Early payout requests require account-owner verification and Trust Office review."
      },
      {
        id: "SEC-005",
        title: "Cashout Protection",
        icon: "verified_user",
        description: "Cashout transactions require account-owner authorization and appropriate Trust processing."
      },
      {
        id: "SEC-006",
        title: "Security Activity",
        icon: "manage_history",
        description: "Registered beneficiaries can review relevant security events and account activity."
      }
    ],
    personalSecurityFeatures: [
      "Passkey / biometric registration",
      "Authorized devices",
      "Recent sign-ins",
      "Security alerts",
      "Session management",
      "Credential recovery",
      "Security-event history"
    ]
  },


  /* ==========================================================
     3. MY DOCUMENTS
     ========================================================== */
  documents: {
    title: "My Documents",
    introduction: "Your personal Trust documents and documents submitted during registration.",
    beforeRegistration: {
      title: "Prepare Your Documents",
      message: "You can review document requirements before registration. Personal document storage and verification become available after registration.",
      checklist: [
        "Valid identity document",
        "Required registration information",
        "Parent information where applicable",
        "Supporting documents where requested",
        "Clear PDF, JPG or PNG copies where uploads are required"
      ]
    },
    categories: [
      {
        id: "IDENTITY",
        title: "Identity Documents",
        description: "Documents used to establish identity."
      },
      {
        id: "LINEAGE",
        title: "Lineage / Supporting Documents",
        description: "Evidence requested for beneficiary lineage verification where applicable."
      },
      {
        id: "TRUST",
        title: "Trust Documents",
        description: "Documents and notices issued by the Trust to the beneficiary."
      },
      {
        id: "APPLICATIONS",
        title: "Applications & Forms",
        description: "Forms and application records submitted by the beneficiary."
      },
      {
        id: "CERTIFICATES",
        title: "Certificates & Statements",
        description: "Trust-issued certificates, statements and confirmations."
      }
    ],
    statuses: [
      "NOT_UPLOADED",
      "SUBMITTED",
      "UNDER_REVIEW",
      "VERIFIED",
      "REQUIRES_UPDATE",
      "EXPIRED",
      "REVOKED"
    ],
    documentControls: [
      "View",
      "Download",
      "Upload replacement",
      "View verification status",
      "View document version"
    ]
  },


  /* ==========================================================
     4. BENEFITS
     ========================================================== */
  benefits: {
    title: "Benefits",
    introduction: "Trust benefits and services available according to applicable eligibility and approval rules.",
    beforeRegistrationMessage: "You can view the benefit catalogue before registration. Personal eligibility is determined after registration and verification.",
    items: [
      {
        id: "BEN-001",
        title: "Beneficiary Account",
        icon: "account_balance_wallet",
        status: "REGISTRATION_REQUIRED",
        description: "Access to an eligible beneficiary account after registration and approval."
      },
      {
        id: "BEN-002",
        title: "Trust Card / Virtual Card",
        icon: "credit_card",
        status: "REGISTRATION_REQUIRED",
        description: "Eligible beneficiaries may apply for available Trust card services."
      },
      {
        id: "BEN-003",
        title: "Payout Services",
        icon: "payments",
        status: "ELIGIBILITY_REQUIRED",
        description: "Eligible beneficiaries may submit payment requests subject to Trust rules and approval."
      },
      {
        id: "BEN-004",
        title: "Cashout Services",
        icon: "account_balance",
        status: "ACCOUNT_REQUIRED",
        description: "Available account funds may be moved through approved cashout methods after required verification."
      },
      {
        id: "BEN-005",
        title: "Employment Opportunities",
        icon: "work",
        status: "APPLICATION_REQUIRED",
        description: "Beneficiaries may view and apply for available vacancies where they meet requirements."
      },
      {
        id: "BEN-006",
        title: "Educational & Development Resources",
        icon: "school",
        status: "ACCESS_DEPENDENT",
        description: "Approved educational, skills, agricultural, business and development resources."
      },
      {
        id: "BEN-007",
        title: "Trust Information Services",
        icon: "info",
        status: "AVAILABLE",
        description: "General Trust information and beneficiary guidance."
      }
    ]
  },


  /* ==========================================================
     5. ACCOUNTS
     ========================================================== */
  accounts: {
    title: "Accounts",
    introduction: "Your financial account services and Trust payment tools.",
    beforeRegistration: {
      title: "Beneficiary Account",
      message: "Your personal balance and transaction information will appear after registration, approval and account activation.",
      services: [
        {
          id: "ACC-001",
          title: "Account Balance",
          icon: "account_balance_wallet",
          description: "View your available beneficiary account balance."
        },
        {
          id: "ACC-002",
          title: "Trust Card",
          icon: "credit_card",
          description: "Access eligible Trust card services. Protected card details require security verification."
        },
        {
          id: "ACC-003",
          title: "Request Payout",
          icon: "payments",
          description: "Submit an eligible early/emergency payout request to the Trust Office for review."
        },
        {
          id: "ACC-004",
          title: "Cashout",
          icon: "account_balance",
          description: "Move available funds through an approved method after required verification."
        },
        {
          id: "ACC-005",
          title: "Transaction History",
          icon: "receipt_long",
          description: "Review approved account transactions after activation."
        }
      ]
    },
    statuses: [
      "NOT_ACTIVE",
      "PENDING_REVIEW",
      "ACTIVE",
      "SUSPENDED",
      "CLOSED"
    ],
    cashoutMethods: [
      "Bank",
      "Ecocash",
      "Trust Card",
      "Other Approved Method"
    ],
    payoutTypes: [
      "EARLY_EMERGENCY_PAYOUT"
    ]
  },


  /* ==========================================================
     6. COMPANIES
     ========================================================== */
  companies: [
    {
      id: "GH",
      name: "Guvaza Holdings",
      color: "#7a1a24",
      info: "Holdings",
      description: "The Guvaza Family Trust company group and holding activities."
    },
    {
      id: "GA",
      name: "Guvaza Agri",
      color: "#10b981",
      info: "Agriculture",
      description: "Agricultural and farming-related activities."
    },
    {
      id: "GL",
      name: "Guvaza Logistics",
      color: "#3b82f6",
      info: "Logistics",
      description: "Transport, logistics and supply-chain activities."
    },
    {
      id: "GP",
      name: "Guvaza Properties",
      color: "#8b5cf6",
      info: "Properties",
      description: "Property and real-estate activities."
    },
    {
      id: "GF",
      name: "Guvaza Finance",
      color: "#f59e0b",
      info: "Finance",
      description: "Financial and related Trust business activities."
    },
    {
      id: "GE",
      name: "Guvaza Energy",
      color: "#ef4444",
      info: "Energy",
      description: "Energy-related business activities."
    },
    {
      id: "GR",
      name: "Guvaza Retail",
      color: "#ec4899",
      info: "Retail",
      description: "Retail and consumer business activities."
    },
    {
      id: "GT",
      name: "Guvaza Tech",
      color: "#06b6d4",
      info: "Technology",
      description: "Technology and digital business activities."
    },
    {
      id: "GH2",
      name: "Guvaza Health",
      color: "#10b981",
      info: "Health",
      description: "Health-related business activities."
    },
    {
      id: "GC",
      name: "Guvaza Construction",
      color: "#f97316",
      info: "Construction",
      description: "Construction and infrastructure activities."
    },
    {
      id: "GF2",
      name: "Guvaza Foods",
      color: "#84cc16",
      info: "Foods",
      description: "Food-related business activities."
    },
    {
      id: "GM",
      name: "Guvaza Media",
      color: "#6366f1",
      info: "Media",
      description: "Media and communications activities."
    }
  ],


  /* ==========================================================
     7. JOBS
     ========================================================== */
  jobs: {
    title: "Jobs & Opportunities",
    notice: "Beneficiary status does not guarantee employment. Vacancies require the stated qualifications and an application.",
    beforeRegistration: "Public vacancy information can be viewed before registration. Personal applications and application tracking require an active beneficiary account.",
    vacancies: [
      {
        jobId: "JOB-001",
        title: "Operations Manager",
        companyId: "GH",
        company: "Guvaza Holdings",
        employmentType: "Full-time",
        location: "Harare",
        closingDate: "2026-09-30",
        status: "OPEN",
        description: "Operations management opportunity. Applicants must meet the stated qualifications and requirements."
      },
      {
        jobId: "JOB-002",
        title: "Finance Assistant",
        companyId: "GF",
        company: "Guvaza Finance",
        employmentType: "Part-time",
        location: "Remote",
        closingDate: "2026-10-15",
        status: "OPEN",
        description: "Finance support opportunity. Applicants must meet the stated qualifications and requirements."
      },
      {
        jobId: "JOB-003",
        title: "Agri Field Officer",
        companyId: "GA",
        company: "Guvaza Agri",
        employmentType: "Contract",
        location: "Murewa",
        closingDate: "2026-09-20",
        status: "CLOSED",
        description: "Agricultural field opportunity. The listed closing date has passed."
      }
    ],
    applicationStatuses: [
      "NOT_APPLIED",
      "SUBMITTED",
      "UNDER_REVIEW",
      "SHORTLISTED",
      "INTERVIEW",
      "OFFERED",
      "REJECTED",
      "WITHDRAWN"
    ]
  },


  /* ==========================================================
     8. PROFILE
     ========================================================== */
  profile: {
    title: "Profile",
    rule: "Profile contains personal account information only. My Direct Lineage and Whole Clan Tree remain separate main-screen functions.",
    beforeRegistration: {
      status: "NOT_REGISTERED",
      heading: "Beneficiary Registration",
      message: "Complete beneficiary registration to create and verify your personal GFT profile.",
      actions: [
        {
          id: "REGISTER",
          label: "Register as Beneficiary",
          href: "register.html"
        },
        {
          id: "LOGIN",
          label: "Beneficiary Login",
          href: "beneficiary-login.html"
        }
      ]
    },
    fields: [
      "Full Name",
      "Official GFT System ID",
      "Gender",
      "Date of Birth",
      "Root Surname",
      "Current Surname",
      "Registration Status",
      "Identity Verification Status",
      "Lineage Verification Status",
      "Account Status",
      "Email Verification Status"
    ],
    excludedFromProfile: [
      "My Direct Lineage",
      "Whole Clan Tree"
    ]
  },


  /* ==========================================================
     9. TRUST LIBRARY
     The beneficiary portal is an access layer to the real
     Library system. It is NOT simply a copy of library.html.
     ========================================================== */
  trustLibrary: {
    title: "Trust Library",

    introduction:
      "The Trust Library provides controlled access to Trust knowledge, publications, public resources, protected materials and beneficiary-specific resources.",

    architecture:
      "The portal Library is an access layer. The actual Library documents and protected files should remain in the Trust's document/library storage system.",

    accessPrinciples: [
      "Public materials may remain freely accessible through the public Library.",
      "Beneficiary access is determined by authorization and entitlement.",
      "Protected materials may require registration, approval, subscription or additional Trust authorization.",
      "Personal beneficiary materials are separate from public Library materials.",
      "Access can expire, be renewed, restricted or revoked according to Trust rules.",
      "Every protected access and download can be recorded in an audit trail."
    ],

    /* Distinct Library portals / windows */
    portals: [

      {
        id: "LIB-PUBLIC",
        title: "Public Library",
        color: "#0f766e",
        icon: "public",
        access: "PUBLIC",
        description:
          "Materials intentionally made available to the general public.",
        actions: [
          "Browse",
          "Search",
          "Read",
          "Download where permitted"
        ]
      },

      {
        id: "LIB-PERMITTED",
        title: "Permitted Trust Materials",
        color: "#1d4ed8",
        icon: "verified",
        access: "BENEFICIARY_ENTITLEMENT",
        description:
          "Materials from the Trust's real Library that this beneficiary is authorized to access.",
        actions: [
          "Browse",
          "Search",
          "Read",
          "Download where permitted"
        ]
      },

      {
        id: "LIB-MY-DOWNLOADS",
        title: "My Downloads",
        color: "#7c3aed",
        icon: "download",
        access: "REGISTERED_BENEFICIARY",
        description:
          "A personal record of materials the beneficiary has downloaded or been issued.",
        actions: [
          "View",
          "Download again where permitted",
          "View version",
          "View access date"
        ]
      },

      {
        id: "LIB-PREMIUM",
        title: "Premium / Protected Materials",
        color: "#a16207",
        icon: "workspace_premium",
        access: "SUBSCRIPTION_OR_AUTHORIZATION",
        description:
          "Important or commercially protected material made available through a Trust-controlled entitlement.",
        actions: [
          "View access requirement",
          "Subscribe where offered",
          "Request authorization",
          "Access when entitled"
        ]
      },

      {
        id: "LIB-MONTHLY",
        title: "Monthly Library Access",
        color: "#9f1239",
        icon: "calendar_month",
        access: "SUBSCRIPTION",
        description:
          "The Trust's controlled monthly subscription mechanism for selected protected Library materials.",
        actions: [
          "View current subscription",
          "View renewal date",
          "View access tier",
          "Renew where applicable",
          "View subscription history"
        ]
      },

      {
        id: "LIB-REQUIRED",
        title: "Required Reading",
        color: "#166534",
        icon: "menu_book",
        access: "TRUST_ASSIGNED",
        description:
          "Materials the Trust requires a beneficiary to read or acknowledge.",
        actions: [
          "Open",
          "Read",
          "Acknowledge",
          "View completion status"
        ]
      },

      {
        id: "LIB-PERSONAL",
        title: "My Issued Materials",
        color: "#be185d",
        icon: "folder_shared",
        access: "PERSONAL",
        description:
          "Materials specifically issued to this beneficiary by the Trust.",
        actions: [
          "View",
          "Download",
          "Acknowledge where required"
        ]
      },

      {
        id: "LIB-FAMILY",
        title: "Family / Lineage Materials",
        color: "#4338ca",
        icon: "account_tree",
        access: "LINEAGE_AUTHORIZATION",
        description:
          "Materials that may be made available according to authorized family or lineage access rules.",
        actions: [
          "View when authorized",
          "Download where permitted"
        ]
      },

      {
        id: "LIB-DEVELOPMENT",
        title: "Education & Development",
        color: "#047857",
        icon: "school",
        access: "BENEFICIARY_PROGRAMME",
        description:
          "Educational, agricultural, business, financial, employment and development resources.",
        actions: [
          "Browse",
          "Search",
          "Read",
          "Download where permitted"
        ]
      },

      {
        id: "LIB-FORMS",
        title: "Forms & Applications",
        color: "#0369a1",
        icon: "description",
        access: "PUBLIC_OR_BENEFICIARY",
        description:
          "Current Trust forms, applications and templates.",
        actions: [
          "View",
          "Download",
          "Submit where connected"
        ]
      },

      {
        id: "LIB-NOTICES",
        title: "Notices & Circulars",
        color: "#c2410c",
        icon: "campaign",
        access: "PUBLIC_OR_BENEFICIARY",
        description:
          "Trust circulars, notices, deadlines and permanent reference announcements.",
        actions: [
          "Read",
          "Download"
        ]
      },

      {
        id: "LIB-ARCHIVE",
        title: "Library Archive",
        color: "#475569",
        icon: "inventory_2",
        access: "CONTROLLED",
        description:
          "Older Library materials retained for historical or reference purposes.",
        actions: [
          "Search",
          "Read where permitted",
          "Download where permitted"
        ]
      },

      {
        id: "LIB-RESTRICTED",
        title: "Restricted Materials",
        color: "#7f1d1d",
        icon: "lock",
        access: "SPECIAL_AUTHORIZATION",
        description:
          "Materials requiring special Trust authorization, entitlement or other controlled access.",
        actions: [
          "View access requirements",
          "Request authorization",
          "Open when approved"
        ]
      },

      {
        id: "LIB-HISTORY",
        title: "Access History",
        color: "#334155",
        icon: "history",
        access: "REGISTERED_BENEFICIARY",
        description:
          "A record of relevant Library access, downloads, acknowledgements and subscription activity.",
        actions: [
          "View access history",
          "View download history",
          "View acknowledgement history"
        ]
      }
    ],

    /* Library classification model */
    materialClassifications: [
      {
        code: "PUBLIC",
        title: "Public",
        description: "Available to the general public."
      },
      {
        code: "BENEFICIARY",
        title: "Beneficiary",
        description: "Available to registered beneficiaries according to Trust rules."
      },
      {
        code: "ENTITLED",
        title: "Entitled",
        description: "Available only when the beneficiary meets a defined entitlement."
      },
      {
        code: "SUBSCRIPTION",
        title: "Subscription",
        description: "Available while the required subscription/access entitlement is active."
      },
      {
        code: "PROGRAMME",
        title: "Programme",
        description: "Available to beneficiaries enrolled in a relevant Trust programme."
      },
      {
        code: "PERSONAL",
        title: "Personal",
        description: "Issued specifically to an individual beneficiary."
      },
      {
        code: "LINEAGE",
        title: "Lineage",
        description: "Controlled according to an approved family/lineage access rule."
      },
      {
        code: "RESTRICTED",
        title: "Restricted",
        description: "Requires special Trust authorization."
      },
      {
        code: "ARCHIVED",
        title: "Archived",
        description: "Historical/reference material retained in the Library."
      }
    ],

    /* Monthly subscription/access model */
    subscription: {
      enabled: true,
      title: "Monthly Library Access",
      purpose:
        "Allows the Trust to control beneficiary access to selected important or commercially protected Library materials.",

      tiers: [
        {
          id: "LIB-BASIC",
          name: "Basic",
          description: "Access to materials included in the basic beneficiary entitlement.",
          accessClassifications: ["PUBLIC", "BENEFICIARY"]
        },
        {
          id: "LIB-STANDARD",
          name: "Standard",
          description: "Expanded access to selected protected materials.",
          accessClassifications: ["PUBLIC", "BENEFICIARY", "ENTITLED", "PROGRAMME"]
        },
        {
          id: "LIB-PREMIUM",
          name: "Premium",
          description: "Access to selected premium/protected materials while the entitlement is active.",
          accessClassifications: ["PUBLIC", "BENEFICIARY", "ENTITLED", "PROGRAMME", "SUBSCRIPTION"]
        },
        {
          id: "LIB-SPECIAL",
          name: "Special Authorization",
          description: "Special access granted by the Trust for restricted materials.",
          accessClassifications: ["PUBLIC", "BENEFICIARY", "ENTITLED", "PROGRAMME", "SUBSCRIPTION", "RESTRICTED"]
        }
      ],

      statuses: [
        "NOT_ACTIVE",
        "ACTIVE",
        "PAYMENT_PENDING",
        "EXPIRED",
        "SUSPENDED",
        "CANCELLED",
        "REVOKED"
      ],

      renewal: {
        frequency: "MONTHLY",
        gracePeriodSupported: true,
        autoRenewalSupported: false
      },

      importantRule:
        "Subscription entitlement should be enforced server-side. The browser must never be treated as the authority for granting access to protected material."
    },

    /* Access-control factors */
    accessFactors: [
      "Registration status",
      "Beneficiary verification status",
      "Account status",
      "Benefit eligibility",
      "Programme membership",
      "Subscription status",
      "Subscription tier",
      "Special Trust authorization",
      "Family/lineage authorization where applicable",
      "Document acknowledgement requirements",
      "Material classification",
      "Material publication status",
      "Material version",
      "Access start date",
      "Access expiry date",
      "Geographic/legal restrictions where applicable",
      "Trust-imposed suspension or revocation"
    ],

    /* Document metadata expected from the real Library system */
    materialRecordFields: [
      "materialId",
      "title",
      "description",
      "category",
      "classification",
      "version",
      "publishedDate",
      "updatedDate",
      "authorOrOwner",
      "fileType",
      "fileSize",
      "thumbnail",
      "downloadAllowed",
      "readOnlineAllowed",
      "subscriptionRequired",
      "requiredTier",
      "requiresAcknowledgement",
      "accessStart",
      "accessExpiry",
      "status"
    ],

    /* Beneficiary audit history */
    auditEvents: [
      "VIEWED",
      "DOWNLOADED",
      "ACKNOWLEDGED",
      "SUBSCRIPTION_STARTED",
      "SUBSCRIPTION_RENEWED",
      "SUBSCRIPTION_EXPIRED",
      "ACCESS_GRANTED",
      "ACCESS_DENIED",
      "ACCESS_REVOKED"
    ],

    /* What happens before registration */
    beforeRegistration: {
      title: "Trust Library Preview",
      message:
        "You can explore public Library resources and learn about beneficiary-only, subscription and protected materials before registration.",
      available: [
        "Public materials",
        "Library categories",
        "Access rules",
        "Subscription information",
        "General Trust publications",
        "Registration guidance"
      ],
      unavailable: [
        "Personal issued materials",
        "Personal download history",
        "Protected beneficiary-only materials",
        "Restricted materials",
        "Personal subscription account"
      ]
    },

    /* ========================================================
       GFT SERVICES & FAMILY CENTRE
       Founder/Admin may manage these definitions.
       Production changes should be saved server-side with an audit trail.
       ======================================================== */
    services: [
      {id:"family", title:"My Family", icon:"account_tree", action:"direct-lineage", order:10, enabled:true, description:"Your verified direct family line.", colors:{from:"#351329",to:"#7b234f",icon:"#f9a8d4"}},
      {id:"clan", title:"Clan Tree", icon:"family_restroom", action:"clan-tree", order:20, enabled:true, description:"Explore the wider Guvaza family tree.", colors:{from:"#111d4a",to:"#274690",icon:"#bfdbfe"}},
      {id:"library", title:"Trust Library", icon:"local_library", action:"view:library", order:30, enabled:true, description:"Trust materials and authorised resources.", colors:{from:"#172554",to:"#49346f",icon:"#f5d77a"}},
      {id:"notifications", title:"Notifications", icon:"notifications", action:"view:notifications", order:40, enabled:true, description:"Trust announcements and alerts.", colors:{from:"#431407",to:"#9a3412",icon:"#fed7aa"}},
      {id:"security", title:"Security", icon:"security", action:"view:security", order:50, enabled:true, description:"Biometric and account security.", colors:{from:"#0c1b3a",to:"#1d4ed8",icon:"#bfdbfe"}},
      {id:"documents", title:"My Documents", icon:"folder_copy", action:"view:documents", order:60, enabled:true, description:"Requirements and personal documents.", colors:{from:"#1e293b",to:"#475569",icon:"#e2e8f0"}},
      {id:"benefits", title:"Benefits", icon:"card_giftcard", action:"view:benefits", order:70, enabled:true, description:"Available Trust benefits and eligibility.", colors:{from:"#052e16",to:"#15803d",icon:"#bbf7d0"}},
      {id:"history", title:"Requests & History", icon:"receipt_long", action:"view:history", order:80, enabled:true, description:"Payout, cashout and request records.", colors:{from:"#0c1f2e",to:"#155e75",icon:"#a5f3fc"}},
      {id:"accounts", title:"Accounts", icon:"account_balance_wallet", action:"view:accounts", order:90, enabled:true, description:"Balance, Trust Card and cashout services.", colors:{from:"#082f49",to:"#0369a1",icon:"#bae6fd"}},
      {id:"companies", title:"Companies", icon:"business", action:"view:companies", order:100, enabled:true, description:"Explore GFT companies and opportunities.", colors:{from:"#2e1065",to:"#7e22ce",icon:"#e9d5ff"}},
      {id:"jobs", title:"Jobs", icon:"work", action:"view:jobs", order:110, enabled:true, description:"View vacancies and application opportunities.", colors:{from:"#422006",to:"#a16207",icon:"#fef08a"}},
      {id:"profile", title:"Profile", icon:"person", action:"view:profile", order:120, enabled:true, description:"Your personal beneficiary profile.", colors:{from:"#500724",to:"#9d174d",icon:"#fbcfe8"}}
    ],

    serviceManagement: {
      editableFields: ["title","icon","description","order","enabled","colors","action"],
      supportedActions: [
        "view:accounts","view:companies","view:jobs","view:profile",
        "view:notifications","view:security","view:documents","view:benefits",
        "view:library","view:history","direct-lineage","clan-tree"
      ],
      futureServicePolicy: "New services should receive a unique id, display title, Material Icon name, action/view, order, colour theme and enabled status.",
      authorisedRoles: ["FOUNDER","ADMIN"],
      auditRequired: true
    }
  }
};


/* ============================================================
   SAFE GLOBAL EXPORT
   ============================================================ */

if (typeof window !== "undefined") {
  window.GFT_PORTAL_DATA = GFT_PORTAL_DATA;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = GFT_PORTAL_DATA;
}
