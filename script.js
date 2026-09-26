/* ============================================================
   GUVAZA FAMILY TRUST — PUBLIC SITE SCRIPT
   ------------------------------------------------------------
   Purpose:
   - Public website UI and navigation
   - Trust configuration display
   - Public helpers
   - Founder navigation convenience only

   IMPORTANT:
   - This file does NOT store the family database.
   - This file does NOT perform beneficiary registration.
   - This file does NOT determine lineage eligibility.
   - This file does NOT authenticate Founder/Admin users.

   Canonical family data:
       guvazaTree.js

   Trust rules:
       trustRules.js

   Main family tree:
       guvazaMainTree.js
============================================================ */

(function () {
    "use strict";

    /* ========================================================
       PUBLIC SITE INITIALIZATION
    ======================================================== */

    document.addEventListener("DOMContentLoaded", function () {
        applyTrustConfig();
        setupPublicNavigation();
        setupFounderGate();
        setupPublicHelpers();
    });


    /* ========================================================
       TRUST CONFIGURATION
    ======================================================== */

    function applyTrustConfig() {
        const config = window.TRUST_CONFIG || {};

        const trustName =
            config.name ||
            config.trustName ||
            "Guvaza Family Trust";

        const registrationStatus =
            config.registrationStatus ||
            config.status ||
            "";

        document.querySelectorAll("[data-trust-name]").forEach(function (el) {
            el.textContent = trustName;
        });

        document.querySelectorAll("[data-registration-status]").forEach(function (el) {
            el.textContent = registrationStatus;
        });

        document.querySelectorAll("[data-trust-config]").forEach(function (el) {
            const key = el.getAttribute("data-trust-config");

            if (key && Object.prototype.hasOwnProperty.call(config, key)) {
                el.textContent = config[key];
            }
        });
    }


    /* ========================================================
       PUBLIC NAVIGATION
    ======================================================== */

    function setupPublicNavigation() {
        const navLinks = document.querySelectorAll("[data-section]");

        navLinks.forEach(function (link) {
            link.addEventListener("click", function (event) {
                const targetId = link.getAttribute("data-section");

                if (!targetId) {
                    return;
                }

                const target = document.getElementById(targetId);

                if (!target) {
                    return;
                }

                event.preventDefault();

                document.querySelectorAll("[data-section]").forEach(function (item) {
                    item.classList.remove("active");
                });

                link.classList.add("active");

                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            });
        });
    }


    /* ========================================================
       PUBLIC ICON HELPER
    ======================================================== */

    function icon(name, className) {
        const span = document.createElement("span");

        span.className = "mi" + (className ? " " + className : "");
        span.textContent = name || "";

        return span;
    }


    /* ========================================================
       COMPANY EDITING
       --------------------------------------------------------
       The public website must not provide client-side
       authority to change official company/trust information.
    ======================================================== */

    function editCompany() {
        alert(
            "Official company and trust information can only be changed through the authorized Founder/Admin system."
        );
    }


    /* ========================================================
       FAMILY DATA COMPATIBILITY HELPER
       --------------------------------------------------------
       Family data belongs to guvazaTree.js.

       This function is retained only so older public HTML
       pages that call loadFamilyData() do not break.
    ======================================================== */

  async function loadFamilyData() {
  try {
    if (
      typeof window.GFT_API === "undefined" ||
      typeof window.GFT_API.family !== "function"
    ) {
      throw new Error("GFT_API is not loaded");
    }

    const result = await window.GFT_API.family();

    if (!result || result.ok !== true || !Array.isArray(result.people)) {
      throw new Error("Invalid family data returned by GFT API");
    }

    /*
     * Convert PostgreSQL/API field names to the
     * existing frontend family-data structure.
     *
     * PostgreSQL remains the authoritative source.
     */
    familyData = result.people.map(person => ({
      systemId: person.system_id,
      parentId: person.parent_system_id || "",
      fullName: person.full_name || "",
      gender: person.gender || "",
      generation: person.generation,
      branch: person.branch_code || "",
      dob: person.date_of_birth || null,

      ...(person.profile || {})
    }));

    console.log(
      `✔ GFT API loaded ${familyData.length} family members from PostgreSQL`
    );

    /*
     * Do NOT write the family database back into localStorage.
     * PostgreSQL/API is now the live source.
     */

    if (typeof TRUST_RULES !== "undefined") {
      trustRulesData = TRUST_RULES;

      console.log(
        "✔ trustRules.js loaded:",
        TRUST_RULES.root || "GFT Trust Rules"
      );
    }

  } catch (err) {

    console.error(
      "GFT API family loading failed:",
      err
    );

    /*
     * No silent LocalStorage fallback.
     * This prevents an old browser copy from becoming
     * an accidental second family database.
     */
    familyData = [];

    alert(
      "The GFT family database could not be reached. " +
      "Please check that the GFT server is running."
    );
  }
}

    /* ========================================================
       REGISTRATION FORM COMPATIBILITY
       --------------------------------------------------------
       Registration logic belongs to the dedicated registration
       engine/page and trustRules.js.

       This prevents old public-site code from performing
       name-only beneficiary matching.
    ======================================================== */

    function setupRegistrationForm() {
        return true;
    }


    /* ========================================================
       OLD MEMBER CHECK COMPATIBILITY
       --------------------------------------------------------
       Kept only to prevent errors if an older public page
       still calls handleMemberCheck().

       It intentionally does NOT:
       - search by name
       - reveal family membership
       - determine eligibility
       - create registration records
    ======================================================== */

    function handleMemberCheck() {
        alert(
            "Beneficiary verification is handled through the official registration process."
        );

        return false;
    }


    /* ========================================================
       GET FAMILY DATA
       --------------------------------------------------------
       Canonical data must come from guvazaTree.js.
    ======================================================== */

    function getFamilyData() {
        if (
            window.guvazaTree &&
            Array.isArray(window.guvazaTree)
        ) {
            return window.guvazaTree;
        }

        return [];
    }


    /* ========================================================
       HTML ESCAPING HELPER
    ======================================================== */

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return "";
        }

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }


    /* ========================================================
       FOUNDER GATE
       --------------------------------------------------------
       This is ONLY a navigation convenience.

       It is NOT authentication or authorization.

       Real Founder/Admin protection must be implemented
       server-side.
    ======================================================== */

    function setupFounderGate() {
        const founderButtons =
            document.querySelectorAll("[data-founder-gate]");

        founderButtons.forEach(function (button) {
            let clicks = 0;
            let resetTimer = null;

            button.addEventListener("click", function () {
                clicks += 1;

                clearTimeout(resetTimer);

                resetTimer = setTimeout(function () {
                    clicks = 0;
                }, 3000);

                if (clicks >= 5) {
                    clicks = 0;

                    window.location.href = "Founder.html";
                }
            });
        });
    }


    /* ========================================================
       PUBLIC HELPERS
    ======================================================== */

    function setupPublicHelpers() {
        document.querySelectorAll("[data-close-section]").forEach(function (button) {
            button.addEventListener("click", function () {
                const targetId =
                    button.getAttribute("data-close-section");

                if (!targetId) {
                    return;
                }

                const target = document.getElementById(targetId);

                if (target) {
                    target.style.display = "none";
                }
            });
        });
    }


    /* ========================================================
       GLOBAL EXPORT
       --------------------------------------------------------
       Allows existing public HTML pages to continue calling
       the helper functions without maintaining duplicate logic.
    ======================================================== */

    window.GFT_PUBLIC_SCRIPT = {
        applyTrustConfig: applyTrustConfig,
        setupPublicNavigation: setupPublicNavigation,
        icon: icon,
        editCompany: editCompany,
        loadFamilyData: loadFamilyData,
        setupRegistrationForm: setupRegistrationForm,
        handleMemberCheck: handleMemberCheck,
        getFamilyData: getFamilyData,
        escapeHtml: escapeHtml,
        setupFounderGate: setupFounderGate
    };

})();