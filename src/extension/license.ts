/**
 * License verification (Phase 6, D11) — VERIFY-ONLY by design.
 *
 * The model: a separate, private license service signs a LicensePayload with
 * an Ed25519 PRIVATE key. A commercial build embeds the matching PUBLIC key
 * and calls verifyLicense(). This public repository ships:
 *   - the verifier (below), fully tested with ephemeral keys,
 *   - NO public key, NO private key, NO issuance code.
 * The Community edition never calls this — there is nothing to unlock in it.
 *
 * Token format (deliberately boring): base64url(payloadJson) + "." +
 * base64url(ed25519Signature). Offline verification; expiry is checked
 * against the caller-supplied clock so tests stay deterministic.
 */
import { createPublicKey, verify as edVerify } from "node:crypto";
import type { LicensePayload, LicenseStatus } from "./index";

export function decodeLicenseToken(token: string): { payload: LicensePayload; signed: Buffer; sig: Buffer } | undefined {
  const [p, s] = token.split(".");
  if (!p || !s) return undefined;
  try {
    const signed = Buffer.from(p, "base64url");
    const payload = JSON.parse(signed.toString("utf8")) as LicensePayload;
    return { payload, signed, sig: Buffer.from(s, "base64url") };
  } catch {
    return undefined;
  }
}

/**
 * @param publicKeyPem SPKI PEM of the issuer's Ed25519 public key — supplied
 *   by the commercial package, never by this repository.
 * @param now injectable clock (ms since epoch).
 */
export function verifyLicense(token: string, publicKeyPem: string, now: number = Date.now()): LicenseStatus {
  const decoded = decodeLicenseToken(token);
  if (!decoded) return { state: "invalid", reason: "malformed token" };

  let ok = false;
  try {
    ok = edVerify(null, decoded.signed, createPublicKey(publicKeyPem), decoded.sig);
  } catch (err) {
    return { state: "invalid", reason: `verification failed: ${(err as Error).message}` };
  }
  if (!ok) return { state: "invalid", reason: "signature does not match payload" };

  const p = decoded.payload;
  if (p.version !== 1) return { state: "invalid", reason: `unsupported license version ${p.version}` };
  if (p.edition !== "pro" && p.edition !== "team") return { state: "invalid", reason: "unknown edition" };
  if (p.expiresAt && Date.parse(p.expiresAt) < now) {
    return { state: "expired", reason: `expired ${p.expiresAt}` };
  }
  return { state: "valid", payload: p };
}
