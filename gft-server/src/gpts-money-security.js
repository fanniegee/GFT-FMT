import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export const fail = (status, message, code = "ACTION_BLOCKED") =>
  Object.assign(new Error(message), { status, code, gpts: true });
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function minor(value, { zero = false } = {}) {
  if (typeof value !== "string" || !/^\d{1,16}(?:\.\d{1,2})?$/.test(value))
    throw fail(400, "Enter an exact amount with up to two decimal places.");
  const [whole, part = ""] = value.split("."),
    result = BigInt(whole) * 100n + BigInt(part.padEnd(2, "0"));
  if (!zero && result === 0n) throw fail(400, "The amount must be positive.");
  return result;
}
export const decimal = (value) =>
  `${BigInt(value) / 100n}.${String(BigInt(value) % 100n).padStart(2, "0")}`;
export function integer(value, { zero = false } = {}) {
  if (
    typeof value !== "string" ||
    !/^\d{1,19}$/.test(value) ||
    (!zero && BigInt(value) === 0n)
  )
    throw fail(400, "Invalid minor-unit amount.");
  return BigInt(value);
}
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
      .join(",") +
    "}"
  );
}
export function createVault({
  key = process.env.GPTS_DATA_KEY,
  keyId = process.env.GPTS_ACTIVE_KEY_ID || "v1",
  oldKeys = process.env.GPTS_RETIRED_DATA_KEYS || "{}",
} = {}) {
  let keys = new Map();
  try {
    for (const [id, value] of Object.entries({
      ...JSON.parse(oldKeys),
      [keyId]: key,
    })) {
      const bytes = Buffer.from(value || "", "base64");
      if (!/^[a-z0-9-]{1,20}$/.test(id) || bytes.length !== 32) throw Error();
      keys.set(id, bytes);
    }
  } catch {
    keys = new Map();
  }
  const requireKey = () => {
    if (!keys.has(keyId))
      throw fail(
        503,
        "Secure payments storage must be configured before this action.",
        "ENCRYPTION_UNAVAILABLE",
      );
  };
  return {
    configured: () => keys.has(keyId),
    seal(value, context) {
      requireKey();
      const iv = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", keys.get(keyId), iv);
      cipher.setAAD(Buffer.from(context));
      const encrypted = Buffer.concat([
        cipher.update(
          Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)),
        ),
        cipher.final(),
      ]);
      return Buffer.from(
        JSON.stringify({
          v: keyId,
          iv: iv.toString("base64"),
          tag: cipher.getAuthTag().toString("base64"),
          data: encrypted.toString("base64"),
        }),
      );
    },
    open(value, context, { binary = false } = {}) {
      requireKey();
      const envelope = JSON.parse(Buffer.from(value).toString()),
        key = keys.get(envelope.v);
      if (!key)
        throw fail(
          503,
          "The required storage key is unavailable.",
          "ENCRYPTION_UNAVAILABLE",
        );
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(envelope.iv, "base64"),
      );
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const result = Buffer.concat([
        decipher.update(Buffer.from(envelope.data, "base64")),
        decipher.final(),
      ]);
      return binary ? result : JSON.parse(result.toString());
    },
    fingerprint(value) {
      requireKey();
      return createHmac("sha256", keys.get(keyId))
        .update(canonical(value))
        .digest("hex");
    },
  };
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decode32(value) {
  let bits = 0,
    buffer = 0,
    result = [];
  for (const char of value) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw Error("Invalid authenticator secret");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      result.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(result);
}
export function totp(secret, counter) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac("sha1", decode32(secret)).update(bytes).digest(),
    offset = hash.at(-1) & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
export function checkTotp(secret, code, lastCounter, now = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current, current - 1, current + 1])
    if (
      counter > Number(lastCounter) &&
      counter >= 0 &&
      timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code))
    )
      return counter;
  return null;
}
