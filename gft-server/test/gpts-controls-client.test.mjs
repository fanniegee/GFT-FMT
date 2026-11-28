import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("workspace wipes private DOM, recovery codes and forms on page leave or authority change", async () => {
  class Element {
    constructor() {
      this.children = [];
      this.textContent = "";
      this.hidden = false;
      this.disabled = false;
      this.value = "";
      this.resets = 0;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
      this.textContent = nodes.map((node) => node.textContent).join("");
    }
    reset() {
      this.value = "";
      this.resets++;
    }
    querySelector() {
      return new Element();
    }
  }
  const elements = new Map(),
    get = (id) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    };
  const forms = [
      "mfaSetup",
      "mfaConfirm",
      "verificationForm",
      "recipientForm",
      "policyForm",
    ].map(get),
    events = new Map();
  let authority = "A",
    reloaded = 0;
  const context = {
    document: {
      body: { dataset: { controlsRole: "CUSTOMER" }, style: {} },
      getElementById: get,
      createElement: () => new Element(),
      querySelectorAll: (selector) => (selector === "form" ? forms : []),
    },
    window: {
      addEventListener: (name, handler) => events.set(name, handler),
      print() {},
    },
    location: {
      reload: () => {
        reloaded++;
      },
      replace() {},
    },
    URL,
    console,
    FormData: class {},
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => "isolated-request" },
    fetch: async (path) =>
      path.endsWith("/security")
        ? {
            status: 200,
            ok: true,
            json: async () => ({
              ok: true,
              encryptedStorage: false,
              mfaEnabled: false,
              authorityContext: authority,
            }),
          }
        : {
            status: 503,
            ok: false,
            json: async () => ({
              ok: false,
              error: "Isolated refresh unavailable",
            }),
          },
  };
  vm.runInNewContext(
    await readFile(
      new URL("../../gpts-controls-client.js", import.meta.url),
      "utf8",
    ),
    context,
  );
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  await flush();
  events.get("focus")();
  await flush();
  for (const id of [
    "securitySecret",
    "verificationDetail",
    "receiptBody",
    "recipientList",
    "accountOverview",
  ])
    get(id).textContent = "PRIVATE ISOLATED VALUE";
  for (const form of forms) form.value = "PRIVATE FORM VALUE";
  events.get("pagehide")();
  for (const id of [
    "securitySecret",
    "verificationDetail",
    "receiptBody",
    "recipientList",
    "accountOverview",
  ])
    assert.equal(get(id).textContent, "", id + " must be cleared");
  assert.ok(forms.every((form) => form.value === ""));
  assert.equal(get("securitySecret").hidden, true);
  assert.equal(context.document.body.style.visibility, "hidden");
  events.get("focus")();
  await flush();
  get("securitySecret").textContent = "PRIVATE PREVIOUS ACCOUNT";
  authority = "B";
  events.get("focus")();
  await flush();
  assert.equal(reloaded, 1);
  assert.equal(get("securitySecret").textContent, "");
  assert.equal(context.document.body.style.visibility, "hidden");
});
