(() => {
  const $ = (id) => document.getElementById(id);
  const isFounder = Boolean($("transferAdmin"));
  const prefix = isFounder
    ? "/api/founder/beneficiary-transfers"
    : "/api/beneficiary/transfers";
  let nextCursor = null,
    recipient = null,
    wallets = [],
    requestKey = null,
    lastSignature = null,
    lookupVersion = 0,
    historyVersion = 0;
  function node(tag, text) {
    const item = document.createElement(tag);
    if (text) item.textContent = text;
    return item;
  }
  async function api(path = "", method = "GET", body) {
    const response = await fetch(prefix + path, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error || "Unable to complete this request.");
    return data;
  }
  function say(message) {
    $("transferStatus").textContent = message;
  }
  function format(value, currency) {
    return currency.trim() + " " + String(value);
  }
  function date(value) {
    return new Date(value).toLocaleString();
  }
  function record(item) {
    const card = node("article");
    card.className = "transfer-record";
    card.dataset.state = item.status;
    const direction = isFounder
      ? ""
      : item.outgoing
        ? "Sent request"
        : "Incoming request";
    card.append(
      node(
        "h3",
        (direction ? direction + " · " : "") +
          format(item.amount, item.currency),
      ),
      node(
        "p",
        item.sender_name +
          " (" +
          item.sender_system_id +
          ") → " +
          item.recipient_name +
          " (" +
          item.recipient_system_id +
          ")",
      ),
      node("p", item.status + " · " + date(item.created_at)),
      node("small", "Reference " + item.transfer_id),
    );
    if (item.note) card.append(node("p", item.note));
    const details = node("details");
    details.append(node("summary", "Permanent audit trail"));
    const list = node("ol");
    for (const event of item.events) {
      list.append(
        node(
          "li",
          date(event.created_at) +
            " · " +
            event.action +
            (event.actor_role
              ? " · " + event.actor_role + " " + event.actor_id
              : "") +
            (event.note ? "\n" + event.note : ""),
        ),
      );
    }
    details.append(list);
    card.append(details);
    const actions = isFounder
      ? item.status === "PENDING"
        ? [
            ["Authorize", "authorize"],
            ["Reject", "reject"],
            ["Cancel", "cancel"],
          ]
        : item.status === "AUTHORIZED"
          ? [
              ["Execute transfer", "execute"],
              ["Cancel", "cancel"],
            ]
          : []
      : item.outgoing && ["PENDING", "AUTHORIZED"].includes(item.status)
        ? [["Cancel request", "cancel"]]
        : [];
    if (actions.length) {
      const form = node("form");
      form.className = "transfer-actions";
      const label = node("label", "Reason or decision note");
      const note = node("input");
      note.name = "note";
      note.minLength = 3;
      note.maxLength = 500;
      note.required = true;
      label.append(note);
      form.append(label);
      for (const [text, action] of actions) {
        const button = node("button", text);
        button.type = "submit";
        button.value = action;
        form.append(button);
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const action = event.submitter?.value;
        if (!action) return;
        const buttons = [...form.querySelectorAll("button")];
        buttons.forEach((button) => (button.disabled = true));
        try {
          await api("/" + item.transfer_id + "/" + action, "POST", {
            note: note.value.trim(),
          });
          say(
            action === "execute"
              ? "Transfer completed. Both wallets and the permanent ledger have been updated."
              : "Transfer action recorded.",
          );
          await load();
        } catch (error) {
          say(error.message);
        } finally {
          buttons.forEach((button) => (button.disabled = false));
        }
      });
      card.append(form);
    }
    return card;
  }
  async function history(append = false) {
    const version = ++historyVersion;
    const path =
      append && nextCursor ? "?before=" + encodeURIComponent(nextCursor) : "";
    const data = await api(path);
    if (version !== historyVersion) return;
    if (!append) $("transferHistory").replaceChildren();
    $("transferHistory").append(...data.transfers.map(record));
    if (!data.transfers.length && !append)
      $("transferHistory").textContent = "No transfers have been recorded yet.";
    nextCursor = data.nextCursor || null;
    $("transferMore").hidden = !nextCursor;
  }
  function clearRecipient() {
    lookupVersion++;
    recipient = null;
    $("transferRecipientName").textContent = "";
    $("transferConfirm").checked = false;
  }
  function sourceChanged() {
    clearRecipient();
    const source = wallets.find(
      (wallet) => wallet.wallet_id === $("transferSource").value,
    );
    $("transferAvailable").textContent = source
      ? "Available " +
        format(source.available, source.currency) +
        " · Ledger balance " +
        format(source.balance, source.currency)
      : "No verified active wallet is available.";
  }
  async function load() {
    if (!isFounder) {
      const selected = $("transferSource").value,
        data = await api("/wallets");
      wallets = data.wallets;
      $("transferSource").replaceChildren(
        ...wallets.map(
          (wallet) =>
            new Option(
              wallet.currency + " · " + wallet.account_number,
              wallet.wallet_id,
            ),
        ),
      );
      if (wallets.some((wallet) => wallet.wallet_id === selected))
        $("transferSource").value = selected;
      sourceChanged();
      $("transferForm").querySelector("[type=submit]").disabled =
        !wallets.length;
    }
    await history();
    if (typeof refreshBenWallet === "function") refreshBenWallet();
  }
  $("transferRefresh").addEventListener("click", () => {
    say("Refreshing transfers…");
    load().then(() => say("Transfers refreshed.")).catch(error => say(error.message));
  });
  $("transferMore").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await history(true);
    } catch (error) {
      say(error.message);
    } finally {
      button.disabled = false;
    }
  });
  if (isFounder) {
    load().catch((error) => say(error.message));
    return;
  }
  window.loadBeneficiaryTransfers = () =>
    load().catch((error) => say(error.message));
  $("transferSource").addEventListener("change", sourceChanged);
  $("transferRecipientId").addEventListener("input", clearRecipient);
  $("transferAmount").addEventListener("input", () => {
    $("transferConfirm").checked = false;
  });
  $("transferFind").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    clearRecipient();
    say("");
    const version = lookupVersion,
      source = wallets.find(
        (wallet) => wallet.wallet_id === $("transferSource").value,
      );
    if (!source) {
      say("Select an active wallet first.");
      return;
    }
    button.disabled = true;
    try {
      const data = await api(
        "/recipient?systemId=" +
          encodeURIComponent($("transferRecipientId").value.trim()) +
          "&currency=" +
          encodeURIComponent(source.currency),
      );
      if (version !== lookupVersion) return;
      recipient = data.recipient;
      $("transferRecipientName").textContent =
        "Recipient: " + recipient.full_name + " · " + recipient.system_id;
    } catch (error) {
      say(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("transferNew").addEventListener("click", () => {
    $("transferForm").reset();
    requestKey = null;
    lastSignature = null;
    sourceChanged();
    say("");
  });
  $("transferForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!recipient || !$("transferConfirm").checked) {
      say("Find the recipient and confirm the recipient and amount.");
      return;
    }
    const body = {
      sourceWalletId: $("transferSource").value,
      recipientWalletId: recipient.wallet_id,
      recipientSystemId: recipient.system_id,
      recipientName: recipient.full_name,
      amount: $("transferAmount").value,
      note: $("transferNote").value.trim(),
    };
    const signature = JSON.stringify(body);
    if (signature !== lastSignature) {
      requestKey = crypto.randomUUID();
      lastSignature = signature;
    }
    body.requestId = requestKey;
    const button = $("transferForm").querySelector("[type=submit]");
    button.disabled = true;
    say("Submitting your transfer request…");
    try {
      const data = await api("", "POST", body);
      say(
        "Transfer " +
          data.transfer.status +
          ". Reference " +
          data.transfer.transfer_id +
          ". Funds move only after Founder authorization and execution.",
      );
      await history();
      $("transferConfirm").checked = false;
    } catch (error) {
      say(error.message);
    } finally {
      button.disabled = false;
    }
  });
})();
