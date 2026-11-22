(() => {
  const base = "/api/beneficiary";
  const $ = (id) => document.getElementById(id);
  let payments = [];
  function node(tag, text) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    return item;
  }
  function button(text, action) {
    const item = node("button", text);
    item.type = "button";
    item.addEventListener("click", action);
    return item;
  }
  async function api(path, method = "GET", body) {
    const response = await fetch(base + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error || "Unable to complete this request.");
    return data;
  }
  function accountLabel(payment) {
    const details = payment.destination;
    return (
      payment.label +
      " · " +
      payment.method +
      " · " +
      details.accountNumber +
      (payment.is_default ? " · Default" : "")
    );
  }
  function renderPaymentChoices() {
    const selected = $("payoutPaymentMethod").value;
    $("payoutPaymentMethod").replaceChildren(
      ...payments.map(
        (payment) => new Option(accountLabel(payment), payment.payment_id),
      ),
    );
    if (payments.some((item) => item.payment_id === selected))
      $("payoutPaymentMethod").value = selected;
    $("paymentAccounts").replaceChildren();
    for (const payment of payments) {
      const row = node("div");
      row.className = "profile-account";
      row.append(
        node("strong", payment.label),
        node(
          "p",
          payment.method +
            " · " +
            payment.destination.provider +
            " · " +
            payment.destination.accountNumber,
        ),
        node("p", payment.destination.accountHolder),
      );
      row.append(
        button("Edit", () => editPayment(payment)),
        button("Remove", async (event) => {
          event.currentTarget.disabled = true;
          try {
            await api("/profile/payments/" + payment.payment_id, "DELETE", {});
            await loadProfile();
          } catch (error) {
            $("profileStatus").textContent = error.message;
          } finally {
            event.currentTarget.disabled = false;
          }
        }),
      );
      if (payment.is_default)
        row.append(node("small", "Default cashout account"));
      $("paymentAccounts").append(row);
    }
    if (!payments.length)
      $("paymentAccounts").textContent =
        "You have no saved payment accounts yet.";
  }
  function editPayment(payment) {
    const form = $("paymentForm");
    form.elements.paymentId.value = payment?.payment_id || "";
    for (const key of ["label", "method"])
      form.elements[key].value =
        payment?.[key] || (key === "method" ? "Bank" : "");
    for (const key of ["provider", "accountHolder", "accountNumber"])
      form.elements[key].value = payment?.destination[key] || "";
    form.elements.isDefault.checked = payment?.is_default || false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function loadApplications() {
    const data = await api("/profile/applications");
    const host = $("jobApplications");
    host.replaceChildren();
    for (const item of data.applications) {
      const card = node("article");
      card.className = "profile-account";
      card.append(
        node("h4", item.title + " · " + item.company),
        node("p", item.status.replaceAll("_", " ")),
        node(
          "small",
          "Applied " + new Date(item.created_at).toLocaleDateString(),
        ),
      );
      for (const reply of item.replies) {
        const line = node(
          "p",
          reply.status.replaceAll("_", " ") +
            " · " +
            new Date(reply.created_at).toLocaleDateString() +
            "\n" +
            reply.reply,
        );
        line.style.whiteSpace = "pre-wrap";
        card.append(line);
      }
      if (!item.replies.length)
        card.append(
          node(
            "p",
            "Your application has been received. Employer replies will appear here.",
          ),
        );
      host.append(card);
    }
    if (!data.applications.length)
      host.textContent = "You have not submitted any job applications yet.";
  }
  async function loadProfile() {
    const data = await api("/profile/settings");
    payments = data.payments;
    renderPaymentChoices();
    const photo = $("beneficiaryProfilePhoto");
    photo.style.display = "block";
    photo.src = data.photo
      ? base + "/profile/photo?v=" + encodeURIComponent(data.photo)
      : "assets/gft.png";
    await loadApplications();
  }
  window.loadBeneficiaryProfile = () =>
    loadProfile().catch((error) => {
      $("profileStatus").textContent = error.message;
    });
  window.openCashoutModal = async () => {
    openView("home");
    $("payoutMsg").textContent = "Loading your saved cashout accounts…";
    try {
      await loadProfile();
      if (!payments.length) {
        openView("profile");
        $("profileStatus").textContent =
          "Add a trusted payment account before requesting cashout.";
        return;
      }
      $("payoutMsg").textContent =
        "Choose your saved destination and enter the payout amount.";
      $("payoutPaymentMethod").focus();
    } catch (error) {
      $("payoutMsg").textContent = error.message;
    }
  };
  function submit(form, action, status) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const control = form.querySelector('[type="submit"]');
      control.disabled = true;
      status.textContent = "";
      try {
        await action(new FormData(form));
      } catch (error) {
        status.textContent = error.message;
      } finally {
        control.disabled = false;
      }
    });
  }
  async function readFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { name: file.name, base64: btoa(binary) };
  }
  submit(
    $("paymentForm"),
    async (values) => {
      await api("/profile/payments", "POST", {
        paymentId: values.get("paymentId") || undefined,
        label: values.get("label"),
        method: values.get("method"),
        isDefault: values.get("isDefault") === "on",
        destination: {
          provider: values.get("provider"),
          accountHolder: values.get("accountHolder"),
          accountNumber: values.get("accountNumber"),
        },
      });
      $("paymentForm").reset();
      $("paymentForm").elements.paymentId.value = "";
      await loadProfile();
      $("profileStatus").textContent = "Payment account saved.";
    },
    $("profileStatus"),
  );
  $("cancelPaymentEdit").addEventListener("click", () => {
    $("paymentForm").reset();
    $("paymentForm").elements.paymentId.value = "";
  });
  $("profilePhotoFile").addEventListener("change", async (event) => {
    const input = event.currentTarget,
      file = input.files[0];
    if (!file) return;
    input.disabled = true;
    try {
      if (!["image/jpeg", "image/png"].includes(file.type))
        throw Error("Choose a JPEG or PNG image.");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas"),
        scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas
        .getContext("2d")
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (!blob) throw Error("This image could not be prepared.");
      await api("/profile/photo", "PUT", await readFile(blob));
      await loadProfile();
      $("profileStatus").textContent = "Profile image saved.";
    } catch (error) {
      $("profileStatus").textContent = error.message;
    } finally {
      input.disabled = false;
      input.value = "";
    }
  });
  $("removeProfilePhoto").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await api("/profile/photo", "DELETE", {});
      await loadProfile();
    } catch (error) {
      $("profileStatus").textContent = error.message;
    } finally {
      event.currentTarget.disabled = false;
    }
  });
  $("refreshApplications").addEventListener("click", () =>
    loadApplications().catch((error) => {
      $("profileStatus").textContent = error.message;
    }),
  );

  window.renderJobs = async () => {
    const host = $("jobsList");
    host.textContent = "Loading opportunities…";
    try {
      const data = await api("/jobs");
      host.replaceChildren();
      for (const job of data.jobs) {
        const card = node("article");
        card.className = "card";
        card.append(
          node("h3", job.title),
          node("p", job.company + " · " + job.location),
          node("p", "Closes " + job.closing_date.slice(0, 10)),
          node("p", job.description),
        );
        const form = node("form");
        form.className = "profile-form";
        const letter = node("textarea");
        letter.name = "coverLetter";
        letter.required = true;
        letter.maxLength = 5000;
        const label = node("label", "Application / cover letter");
        label.append(letter);
        const cv = node("input");
        cv.type = "file";
        cv.name = "cv";
        cv.accept = "application/pdf";
        cv.required = true;
        const fileLabel = node("label", "CV as PDF (up to 400 KB)");
        fileLabel.append(cv);
        const send = node("button", "Submit application");
        send.type = "submit";
        const status = node("p");
        status.setAttribute("role", "status");
        form.append(label, fileLabel, send, status);
        card.append(form);
        submit(
          form,
          async (values) => {
            const selected = values.get("cv");
            if (!selected.size || selected.size > 400 * 1024)
              throw Error("Choose a PDF CV no larger than 400 KB.");
            await api("/jobs/" + job.job_id + "/applications", "POST", {
              coverLetter: values.get("coverLetter"),
              cv: await readFile(selected),
            });
            form.reset();
            status.textContent =
              "Application submitted. Track your status and replies under Profile.";
          },
          status,
        );
        host.append(card);
      }
      if (!data.jobs.length)
        host.textContent = "No open opportunities have been posted yet.";
    } catch (error) {
      host.textContent = error.message;
    }
  };
  window.loadBeneficiaryProfile();
})();
