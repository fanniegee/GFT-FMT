// Only reviewed server-side integrations are registered here. There is no browser
// or Admin endpoint for supplying adapter code, credentials or arbitrary API URLs.
const registered = new Map();
const methods = [
  "screen",
  "quote",
  "prepareFunding",
  "execute",
  "refund",
  "lookup",
  "verifyEvent",
  "statement",
];
export function registerGptsProvider(key, adapter) {
  if (
    !/^[a-z0-9-]{2,40}$/.test(key) ||
    registered.has(key) ||
    adapter.idempotent !== true ||
    methods.some((method) => typeof adapter[method] !== "function")
  )
    throw Error("Invalid GPTS provider integration");
  registered.set(key, Object.freeze(adapter));
}
export function gptsProviders() {
  return registered;
}
