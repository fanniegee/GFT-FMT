(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    staff = document.body.dataset.controlsRole === "STAFF";
  const root =
    "/api/gpts-payments/control/" + (staff ? "operations" : "customer");
  let securityToken = "",
    expires = 0,
    enrolling = false,
    replaces = null,
    editingVerification = null,
    overview = {},
    policyRoutes = [],
    authorityContext = "",
    refreshing = false;
  const objects = [];
  const el = (tag, value = "", className) => {
    const n = document.createElement(tag);
    n.textContent = value;
    if (className) n.className = className;
    return n;
  };
  const formData = (form) => Object.fromEntries(new FormData(form));
  const money = (value, currency) => {
    const n = BigInt(value || "0"),
      negative = n < 0n,
      a = negative ? -n : n;
    return `${currency} ${negative ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
  };
  const human = (value) => String(value || "").replaceAll("_", " ");
  function say(message) {
    $("controlStatus").textContent = message;
  }
  function tab(name) {
    for (const panel of document.querySelectorAll("[data-panel]"))
      panel.hidden = panel.dataset.panel !== name;
    for (const button of document.querySelectorAll("[data-tab]"))
      button.setAttribute("aria-pressed", String(button.dataset.tab === name));
  }
  for (const button of document.querySelectorAll("[data-tab]"))
    button.onclick = () => tab(button.dataset.tab);
  async function api(path, { body, method, form, binary = false } = {}) {
    if (Date.now() >= expires) securityToken = "";
    const response = await fetch(root + path, {
      method: method || (body || form ? "POST" : "GET"),
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(securityToken ? { "X-GPTS-Stepup": securityToken } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : form ? { body: form } : {}),
    });
    if (response.status === 401) {
      document.body.style.visibility = "hidden";
      location.replace(staff ? "admin.html" : "gpts-customer-access.html");
      throw Error("Please sign in again.");
    }
    if (binary && response.ok) return response.blob();
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error("The service is temporarily unavailable. Please retry.");
    }
    if (!response.ok || !data.ok) {
      if (
        staff &&
        response.status === 403 &&
        ["/security", "/overview"].includes(path) &&
        data.code !== "STEP_UP_REQUIRED"
      ) {
        document.body.style.visibility = "hidden";
        location.replace("admin.html");
      }
      if (data.code === "STEP_UP_REQUIRED") {
        tab("security");
        securityToken = "";
      }
      throw Error(data.error || "Unable to complete this action.");
    }
    if (path === "/security" && data.authorityContext) {
      if (authorityContext && authorityContext !== data.authorityContext) {
        forgetPrivateState();
        location.reload();
        throw Error(
          "Your signed-in account or payments access changed. Reloading securely.",
        );
      }
      authorityContext = data.authorityContext;
    }
    return data;
  }
  async function action(button, callback) {
    if (button) button.disabled = true;
    try {
      await callback();
    } catch (error) {
      say(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }
  function button(label, callback, secondary = true) {
    const b = el("button", label, secondary ? "secondary" : "");
    b.type = "button";
    b.onclick = () => action(b, callback);
    return b;
  }
  function field(
    form,
    label,
    name,
    { type = "text", options, required = true, value = "" } = {},
  ) {
    const wrap = el("label", label),
      input = el(
        options ? "select" : type === "textarea" ? "textarea" : "input",
      );
    input.name = name;
    if (options) {
      for (const [key, text] of options) input.append(new Option(text, key));
    } else if (type !== "textarea") input.type = type;
    input.required = required;
    if (value !== undefined) input.value = value;
    if (type === "textarea") {
      input.minLength = 8;
      input.maxLength = 2000;
    }
    wrap.append(input);
    form.append(wrap);
    return input;
  }
  function submit(form, label, callback) {
    const b = el("button", label);
    b.type = "submit";
    form.append(b);
    form.onsubmit = (event) => {
      event.preventDefault();
      action(b, () => callback(formData(form)));
    };
    return b;
  }
  function list(id, rows, render, empty = "No records yet.") {
    const target = $(id);
    if (!target) return;
    target.replaceChildren(
      ...(rows.length ? rows.map(render) : [el("p", empty, "control-caption")]),
    );
  }
  function record(title, subtitle) {
    const card = el("article", "", "control-record");
    card.append(el("h3", title));
    if (subtitle) card.append(el("p", subtitle, "control-caption"));
    return card;
  }
  function bind(id, handler) {
    const form = $(id);
    if (!form) return;
    form.onsubmit = (event) => {
      event.preventDefault();
      action(form.querySelector("button[type=submit]"), () =>
        handler(formData(form), form),
      );
    };
  }
  function securityResult(result) {
    securityToken = result.token;
    expires = Date.now() + result.expiresIn * 1000;
    enrolling = false;
    $("securityExpiry").textContent = "Security confirmed for five minutes.";
    if (result.recoveryCodes) {
      $("securitySecret").hidden = false;
      $("securitySecret").textContent =
        "Save these recovery codes securely. Each works once:\n\n" +
        result.recoveryCodes.join("\n");
    } else {
      $("securitySecret").hidden = true;
      $("securitySecret").textContent = "";
    }
    say("Security confirmed. You can continue your sensitive action.");
  }
  bind("mfaSetup", async (data, form) => {
    const result = await api("/security/setup", { body: data });
    form.reset();
    enrolling = true;
    $("securitySecret").hidden = false;
    $("securitySecret").textContent =
      "In your authenticator, add a time-based account named GPTS. Enter this setup key:\n\n" +
      result.secret +
      "\n\nThen confirm the six-digit code below. Never share this key.";
    say("Authenticator setup started. Enter the code to finish.");
  });
  bind("mfaConfirm", async (data, form) => {
    const result = await api("/security/confirm", {
      body: { code: data.code.trim(), enrol: enrolling },
    });
    form.reset();
    securityResult(result);
    await refresh();
  });
  async function security() {
    const data = await api("/security");
    $("securitySummary").textContent = !data.encryptedStorage
      ? "Secure storage configuration is required before sensitive account information can be saved."
      : data.mfaEnabled
        ? "Authenticator enabled. Confirm a fresh code for sensitive actions."
        : "Add your authenticator before saving sensitive details or making payment decisions.";
    $("mfaSetup").hidden = data.mfaEnabled;
  }
  async function customerRefresh() {
    overview = await api("/overview");
    $("accountOverview").replaceChildren(
      el("p", overview.customer.full_name),
      el(
        "p",
        "Financial identity verification: " +
          human(overview.customer.financial_verification),
        "control-tag",
      ),
    );
    $("accountBalances").replaceChildren(
      ...(overview.balances.length
        ? overview.balances.map((row) =>
            el(
              "p",
              `${row.account_id.startsWith("RESERVED:") ? "Reserved for transfer" : "Recorded funds"} · ${money(row.held_minor, row.currency)}`,
            ),
          )
        : [
            el("p", "No customer funds have been recorded.", "control-caption"),
          ]),
    );
    const recipients = (await api("/recipients")).recipients;
    list("recipientList", recipients, (row) => {
      const card = record(
        row.label,
        `${row.country} · ${human(row.method)} · ending ${row.last_four}`,
      );
      if (row.archived_at) card.append(el("span", "Archived", "control-tag"));
      else {
        card.append(
          button("Replace receiving details", async () => {
            replaces = row.recipient_id;
            $("recipientForm").reset();
            $("recipientSave").textContent = "Save replacement recipient";
            say(
              "Enter all replacement details. Previous transfers will retain the original recipient.",
            );
          }),
          button("Archive", async () => {
            await api("/recipients/" + row.recipient_id + "/archive", {
              body: {},
            });
            await refresh();
          }),
        );
      }
      return card;
    });
    $("quoteRecipient").replaceChildren(
      ...recipients
        .filter((r) => !r.archived_at)
        .map(
          (r) =>
            new Option(
              `${r.label} · ${r.country} · ${r.last_four}`,
              r.recipient_id,
            ),
        ),
    );
    const cases = (await api("/verification")).cases;
    list("verificationCases", cases, (row) => {
      const card = record(
        human(row.status),
        "Verification reference: " + row.case_id,
      );
      for (const message of row.messages || [])
        card.append(el("p", message, "control-note"));
      if (row.status === "DRAFT") {
        card.append(
          button("Edit draft identity details", async () => {
            const data = await api("/verification/" + row.case_id + "/draft");
            for (const [name, value] of Object.entries(data.identity))
              $("verificationForm").elements[name].value = value;
            editingVerification = row.case_id;
            say(
              "Editing this verification draft. Save your details before submitting.",
            );
          }),
        );
        const form = el("form");
        const kind = field(form, "Document image", "kind", {
          options: [
            ["IDENTITY_FRONT", "Identity front"],
            ["IDENTITY_BACK", "Identity back"],
            ["ADDRESS", "Address document"],
          ],
        });
        const file = field(form, "JPEG or PNG, up to 5 MB", "image", {
          type: "file",
        });
        file.accept = "image/jpeg,image/png";
        submit(form, "Upload image", async () => {
          if (!file.files[0]) return;
          const body = new FormData();
          body.append("kind", kind.value);
          body.append("image", file.files[0]);
          await api("/verification/" + row.case_id + "/images", { form: body });
          say("Document image saved securely.");
          form.reset();
        });
        card.append(
          form,
          button(
            "Submit for review",
            async () => {
              await api("/verification/" + row.case_id + "/submit", {
                body: {},
              });
              say("Verification submitted for review.");
              await refresh();
            },
            false,
          ),
        );
      }
      return card;
    });
    const instructionsResponse = await fetch(
      "/api/gpts-payments/customer/instructions",
      { cache: "no-store" },
    );
    const instructionsData = await instructionsResponse.json();
    if (!instructionsResponse.ok)
      throw Error(instructionsData.error || "Unable to load instructions.");
    const instructions = instructionsData.instructions.filter(
      (row) => row.status === "AWAITING_CHANNEL",
    );
    $("quoteInstruction").replaceChildren(
      ...instructions.map(
        (row) =>
          new Option(
            `${row.recipient_name} · ${row.currency} ${row.amount} · ${row.corridor_id}`,
            row.instruction_id,
          ),
      ),
    );
    const quoteButton = $("quoteForm").querySelector("button");
    quoteButton.disabled = !overview.providers.length;
    if (!overview.providers.length)
      say(
        "No provider channel is connected yet. Your account and saved instructions remain available.",
      );
    const quotes = (await api("/quotes")).quotes;
    list("quoteList", quotes, (row) => {
      const terms = row.terms,
        card = record(
          "Provider quote",
          new Date(row.expires_at).toLocaleString(),
        );
      card.append(
        el("p", "You send " + money(terms.sendMinor, terms.sourceCurrency)),
        el("p", "Fee " + money(terms.feeMinor, terms.sourceCurrency)),
        el(
          "p",
          "Total funding " + money(terms.totalMinor, terms.sourceCurrency),
        ),
        el(
          "p",
          "Recipient receives " +
            money(terms.receiveMinor, terms.targetCurrency),
        ),
        el("p", "Exchange rate: " + terms.exchangeRate),
      );
      if (Date.parse(row.expires_at) > Date.now()) {
        const form = el("form"),
          label = el("label", "", "control-check"),
          check = el("input");
        check.type = "checkbox";
        check.required = true;
        label.append(
          check,
          el(
            "span",
            "I accept this rate, all displayed fees, the recipient amount and the funding total.",
          ),
        );
        form.append(label);
        const requestId = crypto.randomUUID();
        submit(form, "Accept quote", async () => {
          await api("/transfers", {
            body: {
              quoteId: row.quote_id,
              requestId,
              termsHash: row.terms_hash,
              accept: true,
            },
          });
          say(
            "Quote accepted. Follow the provider funding instructions when available.",
          );
          await refresh();
        });
        card.append(form);
      } else card.append(el("span", "Expired", "control-tag"));
      return card;
    });
    const transfers = (await api("/transfers")).transfers;
    list("transferList", transfers, (row) => transferCard(row, false));
    $("supportTransfer").replaceChildren(
      new Option("Account question", ""),
      ...transfers.map(
        (row) =>
          new Option(
            `${human(row.status)} · ${row.transfer_id}`,
            row.transfer_id,
          ),
      ),
    );
    list("supportList", (await api("/support")).cases, (row) =>
      supportCard(row, false),
    );
  }
  function transferCard(row, operations) {
    const card = record(human(row.status), row.transfer_id);
    card.append(
      el(
        "p",
        `${money(row.terms.sendMinor, row.terms.sourceCurrency)} → ${money(row.terms.receiveMinor, row.terms.targetCurrency)}`,
      ),
      el(
        "p",
        "Confirmed funding: " +
          money(row.funded_minor, row.terms.sourceCurrency),
      ),
      el(
        "p",
        "Confirmed refunds: " +
          money(row.refunded_minor, row.terms.sourceCurrency),
      ),
    );
    if (row.hold_reason)
      card.append(
        el("p", "Review: " + human(row.hold_reason), "control-caption"),
      );
    if (!operations) {
      card.append(
        button("Check provider status", async () => {
          const data = await api(
            "/transfers/" + row.transfer_id + "/provider-status",
            { body: {} },
          );
          say("Provider check completed: " + human(data.status));
          await refresh();
        }),
      );
      if (row.status === "AWAITING_FUNDS")
        card.append(
          button("Show funding instructions", async () => {
            const data = await api(
              "/transfers/" + row.transfer_id + "/funding",
            );
            const text =
              typeof data.instructions === "string"
                ? data.instructions
                : data.instructions
                  ? Object.entries(data.instructions)
                      .map(([key, value]) => `${human(key)}: ${String(value)}`)
                      .join("\n")
                  : "Funding instructions are awaiting provider acknowledgement.";
            const block = el("p", text, "control-secret");
            card.append(block);
          }),
        );
      if (
        [
          "AWAITING_FUNDS",
          "PENDING_APPROVAL",
          "FAILED",
          "REVIEW_REQUIRED",
        ].includes(row.status)
      )
        card.append(
          button("Cancel or request refund", async () => {
            await api("/transfers/" + row.transfer_id + "/cancel", {
              body: {},
            });
            say("Your cancellation or refund request was recorded.");
            await refresh();
          }),
        );
      if (row.status === "SETTLED")
        card.append(
          button("View settlement receipt", async () => {
            const result = await api(
              "/transfers/" + row.transfer_id + "/receipt",
            );
            showReceipt(result.receipt);
          }),
        );
    } else {
      if (["PENDING_APPROVAL", "REFUND_REVIEW"].includes(row.status)) {
        const form = el("form"),
          operation = row.status === "PENDING_APPROVAL" ? "EXECUTE" : "REFUND";
        field(form, "Decision", "decision", {
          options: [
            ["APPROVE", "Approve"],
            ["REJECT", "Reject"],
          ],
        });
        field(form, "Decision reason", "reason", { type: "textarea" });
        submit(
          form,
          "Record " + human(operation).toLowerCase() + " decision",
          async (data) => {
            await api("/transfers/" + row.transfer_id + "/vote", {
              body: { ...data, operation },
            });
            say(
              "Decision recorded. Provider settlement remains a separate event.",
            );
            await refresh();
          },
        );
        card.append(form);
      }
      if (
        ["PENDING_APPROVAL", "FAILED", "REVIEW_REQUIRED"].includes(
          row.status,
        ) &&
        BigInt(row.funded_minor) > BigInt(row.refunded_minor)
      ) {
        const form = el("form");
        field(form, "Refund review reason", "reason", { type: "textarea" });
        submit(form, "Request refund review", async (data) => {
          await api("/transfers/" + row.transfer_id + "/refund", {
            body: data,
          });
          await refresh();
        });
        card.append(form);
      }
    }
    return card;
  }
  function supportCard(row, operations) {
    const card = record(
        row.subject,
        `${row.category} · ${human(row.status)} · ${row.case_id}`,
      ),
      messages = el("div");
    card.append(
      button("Open messages", async () => {
        const data = await api("/support/" + row.case_id + "/messages");
        messages.replaceChildren(
          ...data.messages.map((message) => {
            const item = record(
              message.internal
                ? "Internal staff note"
                : human(message.actor_type),
              new Date(message.created_at).toLocaleString(),
            );
            item.append(el("p", message.body));
            return item;
          }),
        );
      }),
      messages,
    );
    const form = el("form");
    field(form, "Reply", "message", { type: "textarea" });
    let internal;
    if (operations) {
      const wrap = el("label", "", "control-check");
      internal = el("input");
      internal.type = "checkbox";
      wrap.append(internal, el("span", "Internal staff note"));
      form.append(wrap);
      field(form, "Case status", "status", {
        options: [
          ["OPEN", "Open"],
          ["IN_PROGRESS", "In progress"],
          ["CLOSED", "Closed"],
        ],
        value: row.status,
      });
    }
    submit(form, "Send reply", async (data) => {
      if (operations) data.internal = internal.checked;
      await api("/support/" + row.case_id + "/reply", { body: data });
      say("Reply recorded.");
      await refresh();
    });
    card.append(form);
    return card;
  }
  function showReceipt(receipt) {
    const data = receipt.summary;
    $("receiptBody").replaceChildren(
      el("h3", "GPTS Payments"),
      el(
        "p",
        "Confirmed settlement · " + new Date(data.settledAt).toLocaleString(),
      ),
      el("p", "Transfer: " + data.transferId),
      el("p", "Provider reference: " + data.reference),
      el("p", "Sent: " + money(data.sendMinor, data.sourceCurrency)),
      el("p", "Fee: " + money(data.feeMinor, data.sourceCurrency)),
      el("p", "Received: " + money(data.receiveMinor, data.receiveCurrency)),
      el("p", "Exchange rate: " + data.exchangeRate),
      el("p", "Receipt reference: " + receipt.receipt_id, "control-caption"),
    );
    $("receiptPanel").hidden = false;
    $("receiptPanel").scrollIntoView({ behavior: "smooth" });
  }
  $("printReceipt").onclick = () => {
    document.body.classList.add("printing");
    window.print();
    document.body.classList.remove("printing");
  };
  $("closeReceipt").onclick = () => {
    $("receiptPanel").hidden = true;
  };
  function routeRow(route = {}) {
    const container = el("div", "", "control-record"),
      form = el("div");
    const corridor = field(form, "Route", "corridor", {
      options: [
        "ZW-ZA",
        "ZA-ZW",
        "ZW-BW",
        "BW-ZW",
        "ZW-ZM",
        "ZM-ZW",
        "ZW-MZ",
        "MZ-ZW",
      ].map((code) => [code, code.replace("-", " → ")]),
      value: route.corridor || "ZW-ZA",
    });
    const source = field(form, "Sending currency", "sourceCurrency", {
      options: ["USD", "ZWG", "ZAR", "BWP", "ZMW", "MZN"].map((code) => [
        code,
        code,
      ]),
      value: route.sourceCurrency || "USD",
    });
    const target = field(form, "Receiving currency", "targetCurrency", {
      options: ["USD", "ZWG", "ZAR", "BWP", "ZMW", "MZN"].map((code) => [
        code,
        code,
      ]),
      value: route.targetCurrency || "ZAR",
    });
    const provider = field(form, "Connected provider", "providerKey", {
      options: overview.providers.map((key) => [key, key]),
      value: route.providerKey || overview.providers[0],
    });
    const max = field(form, "Maximum funding per transfer", "maxTransfer", {
      value: route.maxTransferMinor
        ? money(route.maxTransferMinor, "").trim()
        : "",
    });
    const daily = field(
      form,
      "Maximum funding in a rolling 24 hours",
      "maxRolling",
      {
        value: route.maxRolling24hMinor
          ? money(route.maxRolling24hMinor, "").trim()
          : "",
      },
    );
    const wrap = el("label", "", "control-check"),
      enabled = el("input");
    enabled.type = "checkbox";
    enabled.checked = Boolean(route.enabled);
    wrap.append(enabled, el("span", "Enable this connected route"));
    form.append(wrap);
    container.append(
      form,
      button("Remove route", async () => {
        policyRoutes = policyRoutes.filter(
          (entry) => entry.container !== container,
        );
        container.remove();
      }),
    );
    $("policyRoutes").append(container);
    policyRoutes.push({
      container,
      values: () => ({
        corridor: corridor.value,
        sourceCurrency: source.value,
        targetCurrency: target.value,
        providerKey: provider.value,
        maxTransferMinor: toMinor(max.value),
        maxRolling24hMinor: toMinor(daily.value),
        enabled: enabled.checked,
      }),
    });
  }
  function toMinor(value) {
    if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value))
      throw Error(
        "Enter a positive funding limit with up to two decimal places.",
      );
    const [whole, part = ""] = value.split(".");
    return String(BigInt(whole) * 100n + BigInt(part.padEnd(2, "0")));
  }
  async function staffRefresh() {
    overview = await api("/overview");
    const assigned = overview.permissions,
      allowed = (name) => assigned.includes(name);
    $("returnPlatform").href = overview.founder ? "founder.html" : "admin.html";
    const visibility = {
      policy: overview.founder,
      verification:
        allowed("verification:review") || allowed("compliance:manage"),
      transfers: allowed("payments:review"),
      finance: allowed("finance:reconcile"),
      support: allowed("support:manage"),
      audit: allowed("audit:view"),
    };
    for (const button of document.querySelectorAll("[data-tab]"))
      if (button.dataset.tab !== "security")
        button.hidden = !visibility[button.dataset.tab];
    if (overview.founder) {
      const configured = overview.policy?.settings;
      if (configured) {
        for (const name of ["approvalQuorum", "verificationQuorum"])
          $("policyForm").elements[name].value = configured[name];
        $("policyForm").elements.verificationChecks.value =
          configured.verificationChecks.join("\n");
      }
      policyRoutes = [];
      $("policyRoutes").replaceChildren();
      for (const route of configured?.routes || []) routeRow(route);
      $("addPolicyRoute").disabled = !overview.providers.length;
      if (securityToken) {
        const people = (await api("/staff")).staff;
        list("staffList", people, (person) => {
          const card = record(person.name, person.email),
            form = el("form"),
            checks = [];
          for (const permission of [
            "operations:view",
            "verification:review",
            "compliance:manage",
            "payments:review",
            "finance:reconcile",
            "support:manage",
            "audit:view",
          ]) {
            const label = el("label", "", "control-check"),
              input = el("input");
            input.type = "checkbox";
            input.value = permission;
            input.checked = person.payment_permissions.includes(permission);
            label.append(
              input,
              el(
                "span",
                {
                  "operations:view": "View payments workspace",
                  "verification:review": "Review identity evidence",
                  "compliance:manage": "Manage compliance restrictions",
                  "payments:review": "Review transfers and refunds",
                  "finance:reconcile": "Reconcile ledger and statements",
                  "support:manage": "Manage customer support",
                  "audit:view": "Read permanent audit history",
                }[permission],
              ),
            );
            form.append(label);
            checks.push(input);
          }
          submit(form, "Save payments access", async () => {
            await api("/staff/" + encodeURIComponent(person.admin_id), {
              body: {
                permissions: checks
                  .filter((check) => check.checked)
                  .map((check) => check.value),
              },
            });
            say("Payments permissions saved.");
            await refresh();
          });
          card.append(form);
          const ownership = el("form");
          field(ownership, "Personal GPTS customer reference", "customerId");
          field(ownership, "Ownership link", "linked", {
            options: [
              ["true", "Link this personal customer account"],
              ["false", "Remove this ownership link"],
            ],
            value: "true",
          });
          submit(
            ownership,
            "Record personal-account ownership",
            async (data) => {
              await api(
                "/staff/" + encodeURIComponent(person.admin_id) + "/ownership",
                {
                  body: {
                    customerId: data.customerId,
                    linked: data.linked === "true",
                  },
                },
              );
              say("Staff/customer ownership link recorded.");
              await refresh();
            },
          );
          card.append(
            el(
              "p",
              "Linked personal customer references: " +
                ((person.personal_customers || []).join(", ") ||
                  "None recorded"),
              "control-caption",
            ),
            ownership,
          );
          return card;
        });
      } else
        $("staffList").textContent =
          "Confirm security to manage staff permissions.";
    }
    $("holdForm").hidden = !allowed("compliance:manage");
    if (allowed("compliance:manage")) {
      const flags = await api("/risk");
      list(
        "riskFlags",
        flags.flags,
        (row) =>
          record(human(row.action), row.actor_id + " · " + row.reference),
        "No security or screening flags recorded.",
      );
    }
    if (allowed("verification:review"))
      list("staffVerifications", (await api("/verifications")).cases, (row) => {
        const card = record(
          row.full_name,
          `${row.email} · ${human(row.status)} · ${row.customer_id}`,
        );
        card.append(button("Review identity", () => verificationDetail(row)));
        return card;
      });
    if (allowed("payments:review"))
      list("staffTransfers", (await api("/transfers")).transfers, (row) =>
        transferCard(row, true),
      );
    if (allowed("finance:reconcile")) {
      $("reconcileProvider").replaceChildren(
        ...overview.providers.map((key) => new Option(key, key)),
      );
      const data = await api("/reconciliation");
      const rows = [
        ...data.issues.map((row) => ({ ...row, kind: "issue" })),
        ...data.events.map((row) => ({ ...row, kind: "event" })),
        ...data.jobs.map((row) => ({ ...row, kind: "job" })),
      ];
      list(
        "financeIssues",
        rows,
        (row) => {
          const card = record(
            human(row.reason || row.error_code || row.last_error || row.status),
            row.issue_id || row.event_id || row.job_id,
          );
          if (row.kind === "issue" && row.status === "OPEN") {
            const form = el("form");
            field(form, "Resolution evidence", "reason", { type: "textarea" });
            submit(form, "Resolve matched issue", async (data) => {
              await api("/reconciliation/issues/" + row.issue_id + "/resolve", {
                body: data,
              });
              await refresh();
            });
            card.append(form);
          }
          if (row.kind === "job" && allowed("payments:review")) {
            const form = el("form");
            field(form, "Recovery review reason", "reason", {
              type: "textarea",
            });
            submit(form, "Resume reviewed operation", async (data) => {
              await api("/jobs/" + row.job_id + "/resume", { body: data });
              await refresh();
            });
            card.append(form);
          }
          if (row.kind === "event") {
            const form = el("form");
            field(form, "Retry reason", "reason", { type: "textarea" });
            submit(form, "Retry verified provider event", async (data) => {
              await api(
                "/events/" +
                  encodeURIComponent(row.provider_key) +
                  "/" +
                  encodeURIComponent(row.event_id) +
                  "/retry",
                { body: data },
              );
              await refresh();
            });
            card.append(form);
          }
          return card;
        },
        "No reconciliation exceptions recorded.",
      );
    }
    if (allowed("support:manage"))
      list("staffSupport", (await api("/support")).cases, (row) =>
        supportCard(row, true),
      );
  }
  async function verificationDetail(row) {
    for (const url of objects) URL.revokeObjectURL(url);
    objects.length = 0;
    const data = await api("/verifications/" + row.case_id),
      target = $("verificationDetail");
    target.replaceChildren(
      el("h3", "Identity review"),
      ...Object.entries(data.identity).map(([key, value]) =>
        el("p", human(key) + ": " + value),
      ),
    );
    for (const image of data.images)
      target.append(
        button("View " + human(image.kind), async () => {
          const blob = await api("/images/" + image.image_id, { binary: true }),
            url = URL.createObjectURL(blob);
          objects.push(url);
          const preview = el("img", "", "control-document");
          preview.src = url;
          preview.alt = human(image.kind);
          target.append(preview);
        }),
      );
    for (const review of data.reviews || [])
      target.append(
        el(
          "p",
          human(review.decision) +
            " · " +
            review.admin_id +
            " · " +
            review.note,
          "control-caption",
        ),
      );
    if (row.status === "SUBMITTED") {
      const form = el("form"),
        checks = [];
      for (const requirement of overview.policy?.settings.verificationChecks ||
        []) {
        const label = el("label", "", "control-check"),
          input = el("input");
        input.type = "checkbox";
        label.append(input, el("span", requirement));
        checks.push({ input, requirement });
        form.append(label);
      }
      field(form, "Review outcome", "decision", {
        options: [
          ["APPROVE", "Approve verified evidence"],
          ["CHANGES_REQUIRED", "Request changes"],
        ],
      });
      field(form, "Review evidence and reason (staff only)", "reason", {
        type: "textarea",
      });
      field(
        form,
        "Message to customer when requesting changes",
        "customerMessage",
        { type: "textarea", required: false },
      ).maxLength = 1000;
      submit(form, "Record identity review", async (data) => {
        data.checks = checks
          .filter((item) => item.input.checked)
          .map((item) => item.requirement);
        await api("/verifications/" + row.case_id + "/review", { body: data });
        target.replaceChildren();
        say("Identity review recorded.");
        await refresh();
      });
      target.append(form);
    }
  }
  bind("recipientForm", async (data, form) => {
    await api(
      replaces ? "/recipients/" + replaces + "/replace" : "/recipients",
      { body: data },
    );
    form.reset();
    replaces = null;
    $("recipientSave").textContent = "Save recipient";
    say("Recipient saved securely.");
    await refresh();
  });
  if ($("recipientNew"))
    $("recipientNew").onclick = () => {
      replaces = null;
      $("recipientForm").reset();
      $("recipientSave").textContent = "Save recipient";
    };
  bind("verificationForm", async (data, form) => {
    await api(
      editingVerification
        ? "/verification/" + editingVerification + "/update"
        : "/verification",
      { body: data },
    );
    editingVerification = null;
    form.reset();
    say("Verification draft saved. Attach an identity image below.");
    await refresh();
  });
  bind("quoteForm", async (data) => {
    await api("/quotes", { body: data });
    say(
      "Provider quote received. Review its amounts and expiry before accepting.",
    );
    await refresh();
  });
  bind("supportForm", async (data, form) => {
    if (!data.transferId) delete data.transferId;
    await api("/support", { body: data });
    form.reset();
    say("Support case opened.");
    await refresh();
  });
  bind("holdForm", async (data) => {
    await api("/customers/" + encodeURIComponent(data.customerId) + "/hold", {
      body: { frozen: data.frozen === "true", reason: data.reason },
    });
    say("Restriction decision recorded.");
    await refresh();
  });
  bind("policyForm", async (data) => {
    await api("/policy", {
      body: {
        approvalQuorum: Number(data.approvalQuorum),
        verificationQuorum: Number(data.verificationQuorum),
        verificationChecks: data.verificationChecks
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        routes: policyRoutes.map((route) => route.values()),
      },
    });
    say("Operating rules saved. Existing accepted terms remain recorded.");
    await refresh();
  });
  if ($("addPolicyRoute")) $("addPolicyRoute").onclick = () => routeRow();
  if ($("runQueue"))
    $("runQueue").onclick = () =>
      action($("runQueue"), async () => {
        const data = await api("/jobs/run", { body: {} });
        say(
          data.processed +
            " queued operations checked. Settlement still requires provider confirmation.",
        );
        await refresh();
      });
  if ($("loadLedger"))
    $("loadLedger").onclick = () =>
      action($("loadLedger"), async () => {
        const data = await api("/ledger");
        list(
          "ledgerTotals",
          data.balances,
          (row) =>
            record(
              {
                ASSET: "Provider cash (debit)",
                LIABILITY: "Customer funds owed (credit)",
                INCOME: "Earned fees (credit)",
                EXPENSE: "Provider costs (debit)",
              }[row.kind],
              money(
                ["LIABILITY", "INCOME"].includes(row.kind)
                  ? String(-BigInt(row.signed_minor))
                  : row.signed_minor,
                row.currency,
              ),
            ),
          "No ledger postings have been recorded.",
        );
      });
  bind("reconcileForm", async (data) => {
    const result = await api(
      "/reconciliation/" + encodeURIComponent(data.provider),
      { body: { date: data.date } },
    );
    say(
      `${result.rows} statement records checked; ${result.issues} exceptions found.`,
    );
    await refresh();
  });
  if ($("loadAudit"))
    $("loadAudit").onclick = () =>
      action($("loadAudit"), async () => {
        const data = await api("/audit");
        list(
          "auditList",
          data.events,
          (row) =>
            record(
              human(row.action),
              `${new Date(row.created_at).toLocaleString()} · ${row.actor_type} ${row.actor_id} · ${row.reference}`,
            ),
          "No payments audit records yet.",
        );
        const history = await api("/policy/history");
        for (const version of history.versions) {
          const card = record(
            "Operating policy version " + version.version,
            version.updated_by +
              " · " +
              new Date(version.created_at).toLocaleString(),
          );
          card.append(
            el(
              "p",
              "Transfer approvals: " +
                version.settings.approvalQuorum +
                " · Identity approvals: " +
                version.settings.verificationQuorum,
            ),
            el(
              "p",
              "Identity checks: " +
                version.settings.verificationChecks.join("; "),
            ),
          );
          for (const route of version.settings.routes)
            card.append(
              el(
                "p",
                route.corridor +
                  " · " +
                  (route.enabled ? "enabled" : "disabled") +
                  " · Funding limit " +
                  money(route.maxTransferMinor, route.sourceCurrency) +
                  " · Rolling 24-hour limit " +
                  money(route.maxRolling24hMinor, route.sourceCurrency),
              ),
            );
          $("auditList").append(card);
        }
      });
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    $("refreshControls").disabled = true;
    try {
      await security();
      if (staff) await staffRefresh();
      else await customerRefresh();
      document.body.style.visibility = "visible";
    } catch (error) {
      forgetPrivateState();
      say(error.message);
      document.body.style.visibility = "visible";
    } finally {
      refreshing = false;
      $("refreshControls").disabled = false;
    }
  }
  $("refreshControls").onclick = refresh;
  function forgetPrivateState() {
    document.body.style.visibility = "hidden";
    securityToken = "";
    expires = 0;
    authorityContext = "";
    enrolling = false;
    replaces = null;
    editingVerification = null;
    overview = {};
    policyRoutes = [];
    for (const form of document.querySelectorAll("form")) form.reset();
    for (const id of [
      "securitySecret",
      "verificationDetail",
      "receiptBody",
      "accountOverview",
      "accountBalances",
      "recipientList",
      "quoteList",
      "transferList",
      "supportList",
      "staffVerifications",
      "staffTransfers",
      "staffSupport",
      "ledgerTotals",
      "financeIssues",
      "auditList",
      "riskFlags",
      "staffList",
      "policyRoutes",
      "verificationCases",
      "quoteRecipient",
      "quoteInstruction",
      "supportTransfer",
      "reconcileProvider",
    ]) {
      const element = $(id);
      if (element) element.replaceChildren();
    }
    $("securitySecret").hidden = true;
    $("receiptPanel").hidden = true;
    $("securityExpiry").textContent = "";
    for (const url of objects) URL.revokeObjectURL(url);
    objects.length = 0;
  }
  $("controlSignOut").onclick = () =>
    action($("controlSignOut"), async () => {
      const response = await fetch(
        staff ? "/api/admin/logout" : "/api/gpts-payments/auth/logout",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok)
        throw Error("Sign out could not be confirmed. Please retry.");
      forgetPrivateState();
      location.replace(staff ? "admin.html" : "gpts.html");
    });
  window.addEventListener("pagehide", forgetPrivateState);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("focus", () => {
    api("/security")
      .then(() => {
        document.body.style.visibility = "visible";
      })
      .catch((error) => say(error.message));
  });
  refresh();
})();
