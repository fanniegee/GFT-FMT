/* ============================================================
   GFT API BRIDGE
   Connects the frontend to the GFT server/API.
   ============================================================ */

(function (window) {
  "use strict";

  const API_BASE = "http://localhost:3000/api";

  async function request(path, options = {}) {
    const response = await fetch(API_BASE + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(
        "GFT API error: " +
        response.status +
        " " +
        response.statusText
      );
    }

    return response.json();
  }

  const GFT_API = {

    /* Server health */
    health() {
      return request("/health");
    },

    /* Canonical family data */
    family() {
      return request("/family");
    },

    /* Retrieve one family member */
    async familyMember(systemId) {
      const result = await request("/family");

      const people = Array.isArray(result.people)
        ? result.people
        : [];

      return people.find(
        person => person.system_id === systemId
      ) || null;
    }

  };

  window.GFT_API = GFT_API;

})(window);