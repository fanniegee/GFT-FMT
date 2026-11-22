(() => {
  let pending;
  function node(tag, text) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    return element;
  }
  function imageUrl(value) {
    try {
      const url = new URL(value, location.href);
      return value && ["http:", "https:"].includes(url.protocol)
        ? url.href
        : "";
    } catch {
      return "";
    }
  }
  async function load() {
    if (!pending)
      pending = (async () => {
        const response = await fetch("/api/config/public", {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data.ok || !Array.isArray(data.config?.companies))
          throw Error(
            "Company information is temporarily unavailable. Please try again.",
          );
        return data.config.companies.filter(
          (company) =>
            company &&
            company.id !== undefined &&
            company.id !== null &&
            company.name,
        );
      })().catch((error) => {
        pending = undefined;
        throw error;
      });
    return pending;
  }
  function brand(company) {
    const wrapper = node("div");
    wrapper.className = "portal-company-brand";
    const fallback = node(
      "span",
      company.name
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join(""),
    );
    wrapper.append(fallback);
    const url = imageUrl(company.logo);
    if (url) {
      const image = node("img");
      image.src = url;
      image.alt = company.name + " logo";
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove());
      image.addEventListener("load", () => {
        fallback.hidden = true;
      });
      wrapper.append(image);
    }
    return wrapper;
  }
  function color(company) {
    return CSS.supports("color", company.color) ? company.color : "#334155";
  }
  function card(company, compact = false) {
    const element = node("article");
    element.className = "portal-company-card";
    element.style.setProperty("--company-color", color(company));
    element.append(
      brand(company),
      node("h3", company.name),
      node("p", company.info || ""),
    );
    if (!compact) {
      const description = node("p", company.description || "");
      description.className = "company-description";
      element.append(description);
    }
    return element;
  }
  window.renderCompanies = async () => {
    const grid = document.getElementById("companiesGrid");
    grid.style.cssText = "";
    grid.className = "portal-company-grid";
    grid.textContent = "Loading Trust companies…";
    try {
      const companies = await load();
      grid.replaceChildren();
      for (const company of companies) {
        const element = card(company);
        const view = node("button", "View company");
        view.type = "button";
        view.addEventListener("click", () => window.openCompanyInside(company));
        const jobs = node("button", "View opportunities");
        jobs.type = "button";
        jobs.addEventListener("click", () =>
          window.showCompanyJobs(company.id),
        );
        const actions = node("div");
        actions.className = "portal-company-actions";
        actions.append(view, jobs);
        element.append(actions);
        grid.append(element);
      }
      if (!companies.length)
        grid.textContent = "No companies are currently configured.";
    } catch (error) {
      grid.textContent = error.message;
    }
  };
  window.openCompanyInside = (company) => {
    const host = document.getElementById("companyDetailContent");
    host.replaceChildren();
    const detail = card(company);
    const banner = imageUrl(company.banner);
    if (banner) {
      const image = node("img");
      image.src = banner;
      image.alt = "";
      image.className = "portal-company-banner";
      image.addEventListener("error", () => image.remove());
      detail.prepend(image);
    }
    const jobs = node("button", "View opportunities from " + company.name);
    jobs.type = "button";
    jobs.addEventListener("click", () => window.showCompanyJobs(company.id));
    detail.append(jobs);
    host.append(detail);
    openView("companyDetail");
  };
  window.beneficiaryJobsCompany = "";
  window.showCompanyJobs = (id) => {
    window.beneficiaryJobsCompany = String(id);
    openView("jobs");
  };
  window.GFTPortalCompanies = { load, card, brand, color };
})();
