(() => {
  const $ = (id) => document.getElementById(id);
  const stages = [
    "UNDER_REVIEW",
    "SHORTLISTED",
    "INTERVIEW",
    "OFFERED",
    "REJECTED",
  ];
  function node(tag, text) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    return item;
  }
  async function api(path, method = "GET", body) {
    const response = await fetch("/api/admin/" + path, {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(result.error || "Unable to complete this request.");
    return result;
  }
  function submit(form, action) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const control = form.querySelector('[type="submit"]');
      control.disabled = true;
      $("status").textContent = "";
      try {
        await action(Object.fromEntries(new FormData(form)));
      } catch (error) {
        $("status").textContent = error.message;
      } finally {
        control.disabled = false;
      }
    });
  }
  async function load() {
    const [jobs, applications] = await Promise.all([
      api("beneficiary-jobs"),
      api("beneficiary-job-applications"),
    ]);
    $("vacancies").replaceChildren();
    for (const job of jobs.jobs) {
      const card = node("article");
      card.append(
        node("h3", job.title + " · " + job.company),
        node("p", job.location + " · Closes " + job.closing_date.slice(0, 10)),
      );
      const toggle = node(
        "button",
        job.active ? "Close vacancy" : "Reopen vacancy",
      );
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          await api("beneficiary-jobs/" + job.job_id, "PATCH", {
            active: !job.active,
          });
          await load();
        } catch (error) {
          $("status").textContent = error.message;
        } finally {
          toggle.disabled = false;
        }
      });
      card.append(toggle);
      $("vacancies").append(card);
    }
    if (!jobs.jobs.length) $("vacancies").textContent = "No vacancies posted.";
    $("applications").replaceChildren();
    for (const application of applications.applications) {
      const card = node("article");
      const letter = node("p", application.cover_letter);
      letter.style.whiteSpace = "pre-wrap";
      card.append(
        node("h3", application.title + " · " + application.company),
        node(
          "p",
          application.full_name +
            " · " +
            application.system_id +
            " · " +
            application.status,
        ),
        letter,
      );
      const cv = node("a", "Download CV");
      cv.href =
        "/api/admin/beneficiary-job-applications/" +
        application.application_id +
        "/cv";
      card.append(cv);
      if (application.reply)
        card.append(node("p", "Latest reply: " + application.reply));
      const form = node("form"),
        select = node("select");
      select.name = "status";
      for (const value of stages)
        select.append(new Option(value.replaceAll("_", " "), value));
      if (stages.includes(application.status))
        select.value = application.status;
      const label = node("label", "Application status");
      label.append(select);
      const reply = node("textarea");
      reply.name = "reply";
      reply.maxLength = 5000;
      reply.required = true;
      const message = node("label", "Reply to beneficiary");
      message.append(reply);
      const send = node("button", "Send reply to Profile");
      send.type = "submit";
      form.append(label, message, send);
      submit(form, async (values) => {
        await api(
          "beneficiary-job-applications/" +
            application.application_id +
            "/reply",
          "POST",
          values,
        );
        await load();
        $("status").textContent = "Reply saved to the beneficiary Profile.";
      });
      card.append(form);
      $("applications").append(card);
    }
    if (!applications.applications.length)
      $("applications").textContent = "No applications received.";
  }
  submit($("newJob"), async (values) => {
    await api("beneficiary-jobs", "POST", values);
    $("newJob").reset();
    await load();
    $("status").textContent = "Vacancy published.";
  });
  $("refresh").addEventListener("click", () =>
    load().catch((error) => {
      $("status").textContent = error.message;
    }),
  );
  load().catch((error) => {
    $("status").textContent = error.message;
  });
})();
