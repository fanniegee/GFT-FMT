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
        "id": 1,
        "info": "Education: The Home Where Future Leaders Begin Their Journey",
        "logo": "assets/company1.png",
        "name": "The Guvaza Imperial Institute",
        "color": "#10b981",
        "banner": "assets/banner1.jpg",
        "profit": 0,
        "gallery": [
            {
                "tag": "Enroll Today",
                "url": "assets/TGII.jpg",
                "caption": ""
            },
            {
                "tag": "Admissions",
                "url": "assets/TGII2.jpg",
                "caption": ""
            },
            {
                "tag": "Join Us",
                "url": "assets/TGII1.jpg",
                "caption": ""
            }
        ],
        "description": "We are committed to providing an affordable, high-quality education that transforms learners into leaders. Our mission is to make every Level of Education easy to understand, easy to revise, and easy to pass."
    },
    {
        "id": 2,
        "info": "Restaurant + BnB: From Our Pastures To Your Table",
        "logo": "assets/company2.png",
        "name": "Guvaza Pitstop Grill",
        "color": "#f59e0b",
        "banner": "assets/banner2.jpg",
        "profit": 0,
        "gallery": [
            {
                "tag": "The Chefs Team:",
                "url": "assets/pit.png",
                "caption": ""
            },
            {
                "tag": "The taste is in their magical hands...",
                "url": "assets/pit1.png",
                "caption": ""
            }
        ],
        "description": "Healthy Food and Clinical Sleep..."
    },
    {
        "id": 3,
        "info": "Beauty Spa",
        "logo": "assets/company3.png",
        "name": "Pristine Glow Lab",
        "color": "#3b82f6",
        "banner": "assets/banner3.jpg",
        "profit": 0,
        "gallery": [],
        "description": "The Best Beauty World"
    },
    {
        "id": 4,
        "info": "Dynamic solutions For Total Security",
        "logo": "assets/company4.png",
        "name": "Guvaza Aegis Dynamics",
        "color": "#06b6d4",
        "banner": "assets/banner4.jpg",
        "profit": 0,
        "gallery": [],
        "description": "Guvaza Aegis Dynamics is a next-generation security company integrating physical security and cyber security under one roof. We protect what matters - your people, premises, and data. From manned guarding, armed response, CCTV and access control to network security, threat monitoring, and data protection, we provide a single, seamless security solution for the modern threat landscape."
    },
    {
        "id": 5,
        "info": "Farming  And Agriculture",
        "logo": "assets/company5.png",
        "name": "AMA - 2K | Aimal And Crop Sciences | Commercial Farming",
        "color": "#84cc16",
        "banner": "assets/banner5.jpg",
        "profit": 0,
        "gallery": [],
        "description": "Commercial farming, poultry, livestock and agro-processing."
    },
    {
        "id": 6,
        "info": "Bar | Groceries | Food Outlet",
        "logo": "assets/company6.png",
        "name": "Triad Nexus Market",
        "color": "#ef4444",
        "banner": "assets/banner6.jpg",
        "profit": 0,
        "gallery": [],
        "description": "Retail shops, supermarkets and general trading."
    },
    {
        "id": 7,
        "info": "Technology Solutions",
        "logo": "assets/company7.png",
        "name": "GPTS | Guvaza Pro-Technology Solutions",
        "color": "#8b5cf6",
        "banner": "assets/banner7.jpg",
        "profit": 0,
        "gallery": [],
        "description": "Software, websites, POS systems and digital solutions."
    },
    {
        "id": 8,
        "info": "One Call - 360 Clean",
        "logo": "assets/company8.png",
        "name": "PristineKlinix360",
        "color": "#eab308",
        "banner": "assets/banner8.jpg",
        "profit": 0,
        "gallery": [],
        "description": "We Clean, So You Don't Have To.\nLife is busy. Cleaning shouldn't be. We give you back your time with sparkling, stress-free cleaning you can trust. Whether it's a regular house clean, a deep clean, or getting your home ready for new tenants, our friendly, professional team treats your home like our own. No shortcuts. Just a fresh, healthy shine."
    },
    {
        "id": 9,
        "info": " Brings Your Dreams to Reality",
        "logo": "assets/company9.png",
        "name": "Guvaza Apex Royal Construction",
        "color": "#f97316",
        "banner": "assets/banner9.jpg",
        "profit": 0,
        "gallery": [
            {
                "tag": "Site Vehicles",
                "url": "assets/tadiwa.png",
                "caption": ""
            },
            {
                "tag": "Professional Operators",
                "url": "assets/tadiwa1.png",
                "caption": ""
            }
        ],
        "description": "Building, renovations, civil works and infrastructure development."
    },
    {
        "id": 10,
        "info": "Mineral Extraction",
        "logo": "assets/min.svg",
        "name": "GFT-Mining",
        "color": "#14b8a6",
        "banner": "assets/banner10.jpg",
        "profit": 0,
        "gallery": [],
        "description": "Legal Extraction, Buying And Selling of Minerals"
    },
    {
        "id": 11,
        "info": "Motor Mechanics  ",
        "logo": "assets/company11.png",
        "name": "G-TECH AUTO LAB",
        "color": "#a855f7",
        "banner": "assets/banner11.jpg",
        "profit": 0,
        "gallery": [],
        "description": "For all your mechanical problems"
    },
    {
        "id": 12,
        "info": "From Our Pastures to The World",
        "logo": "assets/company12.png",
        "name": "Guvaza Dynasty Meats",
        "color": "#ec4899",
        "banner": "assets/banner12.jpg",
        "profit": 0,
        "gallery": [],
        "description": "Best Quality And Original Meat"
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