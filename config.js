/* ============================================================
   GUVAZA FAMILY TRUST
   GLOBAL PUBLIC CONFIGURATION
   ------------------------------------------------------------
   IMPORTANT ARCHITECTURE

   config.js
       ↓
   Public website configuration ONLY

   trustRules.js
       ↓
   Official trust / registration / payout rules

   guvazaTree.js
       ↓
   Canonical family and beneficiary data

   guvazaMainTree.js
       ↓
   Family tree / visual tree model

   config.js MUST NOT:
   - modify beneficiary records
   - modify GFT IDs
   - modify parentId
   - perform lineage verification
   - perform registration
   - authenticate Founder/Admin
   - write beneficiary databases to localStorage
   - use names as beneficiary identity
============================================================ */


/* ============================================================
   1. TRUST IDENTITY
============================================================ */

const TRUST_CONFIG = {

    name: "The Guvaza Family Trust",

    tagline:
        "Building Wealth Together For The Rising Generations",

    email:
        "contact@guvazafamilytrust.org",

    logo:
        "assets/logo.png",

    footerText:
        "© 2026 The Guvaza Family Trust - All Rights Reserved",


    /* ========================================================
       2. PUBLIC DISPLAY CAPS

       These values may be displayed on the public website.

       They are NOT the authoritative payout engine.

       Authoritative rules belong in trustRules.js.
    ======================================================== */

    caps: {

        funeral: 6000,

        school: 5000,

        funeralPayout: 600,

        schoolPayout: 5000

    },


    /* ========================================================
       3. PUBLIC TRUST CONFIGURATION

       Display/reference configuration only.

       Official business logic must remain in trustRules.js.
    ======================================================== */

    rules: {

        expansion: 70,

        pool: 30,

        admin: 2,

        need5Man: true

    },


    /* ========================================================
       4. COMPANIES
    ======================================================== */

    companies: [

        {
            id: 1,
            name: "Transport",
            profit: 0,
            logo: "assets/company1.png",
            banner: "assets/banner1.jpg",
            color: "#10b981",
            info: "Transport & Logistics",
            description:
                "We provide reliable transport, fleet management, cross-border haulage and logistics solutions across Southern Africa.",
            gallery: []
        },

        {
            id: 2,
            name: "Mining",
            profit: 0,
            logo: "assets/company2.png",
            banner: "assets/banner2.jpg",
            color: "#f59e0b",
            info: "Mining Operations",
            description:
                "Mining operations focusing on gold, chrome and lithium.",
            gallery: []
        },

        {
            id: 3,
            name: "Property",
            profit: 0,
            logo: "assets/company3.png",
            banner: "assets/banner3.jpg",
            color: "#3b82f6",
            info: "Property Development",
            description:
                "Residential stands, housing development and commercial property management.",
            gallery: []
        },

        {
            id: 4,
            name: "Logistics",
            profit: 0,
            logo: "assets/company4.png",
            banner: "assets/banner4.jpg",
            color: "#06b6d4",
            info: "Supply Chain",
            description:
                "Warehousing, distribution and supply chain optimization.",
            gallery: []
        },

        {
            id: 5,
            name: "Agriculture",
            profit: 0,
            logo: "assets/company5.png",
            banner: "assets/banner5.jpg",
            color: "#84cc16",
            info: "Farming & Agric",
            description:
                "Commercial farming, poultry, livestock and agro-processing.",
            gallery: []
        },

        {
            id: 6,
            name: "Retail",
            profit: 0,
            logo: "assets/company6.png",
            banner: "assets/banner6.jpg",
            color: "#ef4444",
            info: "Retail & Trading",
            description:
                "Retail shops, supermarkets and general trading.",
            gallery: []
        },

        {
            id: 7,
            name: "Tech",
            profit: 0,
            logo: "assets/company7.png",
            banner: "assets/banner7.jpg",
            color: "#8b5cf6",
            info: "Technology Solutions",
            description:
                "Software, websites, POS systems and digital solutions.",
            gallery: []
        },

        {
            id: 8,
            name: "Energy",
            profit: 0,
            logo: "assets/company8.png",
            banner: "assets/banner8.jpg",
            color: "#eab308",
            info: "Energy & Power",
            description:
                "Solar installations, fuel supply and alternative energy.",
            gallery: []
        },

        {
            id: 9,
            name: "Construction",
            profit: 0,
            logo: "assets/company9.png",
            banner: "assets/banner9.jpg",
            color: "#f97316",
            info: "Construction",
            description:
                "Building, renovations, civil works and infrastructure development.",
            gallery: []
        },

        {
            id: 10,
            name: "Import/Export",
            profit: 0,
            logo: "assets/company10.png",
            banner: "assets/banner10.jpg",
            color: "#14b8a6",
            info: "Import Export Business",
            description:
                "Import and export of goods, vehicles, machinery.",
            gallery: []
        },

        {
            id: 11,
            name: "Finance",
            profit: 0,
            logo: "assets/company11.png",
            banner: "assets/banner11.jpg",
            color: "#a855f7",
            info: "Finance & Savings",
            description:
                "Savings, micro-finance and investment advisory for family.",
            gallery: []
        },

        {
            id: 12,
            name: "Education",
            profit: 0,
            logo: "assets/company12.png",
            banner: "assets/banner12.jpg",
            color: "#ec4899",
            info: "Education & Training",
            description:
                "Scholarships, skills training and education support.",
            gallery: []
        }

    ],


    /* ========================================================
       5. HOMEPAGE
    ======================================================== */

    homepage: {

        heroTitle:
            "The Guvaza Family Trust",

        heroSubtitle:
            "Building Wealth Together For The Rising Generations",

        heroImage:
            "assets/hero.jpg",

        announcement:
            "8th Day Sweep Active - Auto Payouts Enabled",

        showWallets:
            true,

        showCompanies:
            true,

        showBeneficiariesCount:
            true,

        ctaButtonText:
            "Join Trust",

        ctaButtonLink:
            "register.html",


        cards: [

            {
                id: "companies",

                title: "Family Companies",

                subtitle:
                    "Our Growing Business Portfolio",

                icon: "business",

                color: "#4ade80",

                image:
                    "assets/companies.jpg",

                link:
                    "companies.html"
            },

            {
                id: "contact",

                title: "Contact Us",

                subtitle:
                    "We Are Here To Assist You",

                icon: "contact_mail",

                color: "#38bdf8",

                image:
                    "assets/contact.png",

                link:
                    "contact.html"
            },

            {
                id: "about",

                title: "About Us",

                subtitle:
                    "Know Our Roots & Family",

                icon: "groups",

                color: "#fbbf24",

                image:
                    "assets/family1.jpg",

                link:
                    "about.html"
            }

        ]

    },


    /* ========================================================
       6. ABOUT PAGE
    ======================================================== */

    about: {

        title:
            "About Our Family",

        story:
            "Root: Guvaza. Rutambo is son of Guvaza. The Guvaza Family Trust was established to preserve our heritage, build wealth together for the rising generations, and keep our family united under one vision.",

        bannerImage:
            "assets/about-banner.jpg",


        familyMembers: [

            {
                name: "Guvaza",

                caption:
                    "Founder - Root of the family",

                image:
                    "assets/family1.jpg"
            },

            {
                name: "Rutambo",

                caption:
                    "Son of Guvaza",

                image:
                    "assets/family2.jpg"
            },

            {
                name: "Family Elder",

                caption:
                    "Keeper of traditions",

                image:
                    "assets/family3.jpg"
            }

        ]

    },


    /* ========================================================
       7. BRANDING
    ======================================================== */

    branding: {

        primaryColor:
            "#10b981",

        secondaryColor:
            "#3b82f6",

        accentColor:
            "#f59e0b",

        backgroundColor:
            "#0f172a",

        cardBackground:
            "#1e293b"

    },


    /* ========================================================
       8. CONTACT
    ======================================================== */

    contact: {

        phone:
            "+263771234567",

        whatsapp:
            "+263771234567",

        email:
            "contact@guvazafamilytrust.org",

        address:
            "Harare, Zimbabwe"

    },


    /* ========================================================
       9. SOCIAL MEDIA
    ======================================================== */

    social: [

        {
            platform: "Facebook",

            url:
                "https://facebook.com/guvazafamilytrust",

            icon:
                "facebook",

            color:
                "#1877F2"
        },

        {
            platform: "Instagram",

            url:
                "https://instagram.com/guvazafamilytrust",

            icon:
                "photo_camera",

            color:
                "#E4405F"
        },

        {
            platform: "Twitter / X",

            url:
                "https://twitter.com/guvazafamilytrust",

            icon:
                "flutter_dash",

            color:
                "#000000"
        },

        {
            platform: "LinkedIn",

            url:
                "https://linkedin.com/company/guvazafamilytrust",

            icon:
                "work",

            color:
                "#0A66C2"
        },

        {
            platform: "YouTube",

            url:
                "https://youtube.com/@guvazafamilytrust",

            icon:
                "play_circle",

            color:
                "#FF0000"
        },

        {
            platform: "TikTok",

            url:
                "https://tiktok.com/@guvazafamilytrust",

            icon:
                "music_note",

            color:
                "#000000"
        }

    ]

};


/* ============================================================
   GLOBAL EXPORT
   ------------------------------------------------------------
   Makes configuration available to the public website and
   other frontend modules.

   This export contains configuration only.
============================================================ */

window.TRUST_CONFIG = TRUST_CONFIG;