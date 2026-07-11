import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { communityProvider, edition, type LicensePayload } from "../src/extension/index";
import { verifyLicense } from "../src/extension/license";

/** Ephemeral issuer for tests only — the repo ships no keys. */
function makeIssuer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const issue = (payload: LicensePayload): string => {
    const signed = Buffer.from(JSON.stringify(payload), "utf8");
    const sig = edSign(null, signed, privateKey);
    return `${signed.toString("base64url")}.${sig.toString("base64url")}`;
  };
  return { publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(), issue };
}

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  version: 1,
  licenseId: "lic_test",
  edition: "pro",
  issuedAt: "2026-07-01T00:00:00Z",
  features: ["scheduled-reports"],
  ...over,
});

describe("license verification (verify-only)", () => {
  it("a correctly signed license verifies", () => {
    const { publicKeyPem, issue } = makeIssuer();
    const status = verifyLicense(issue(payload()), publicKeyPem);
    expect(status.state).toBe("valid");
    if (status.state === "valid") expect(status.payload.edition).toBe("pro");
  });

  it("a tampered payload is rejected — even a one-character edition upgrade", () => {
    const { publicKeyPem, issue } = makeIssuer();
    const token = issue(payload());
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify(payload({ edition: "team" })), "utf8").toString("base64url");
    const status = verifyLicense(`${forged}.${sig}`, publicKeyPem);
    expect(status.state).toBe("invalid");
  });

  it("a license signed by a DIFFERENT key is rejected", () => {
    const issuerA = makeIssuer();
    const issuerB = makeIssuer();
    const status = verifyLicense(issuerA.issue(payload()), issuerB.publicKeyPem);
    expect(status).toMatchObject({ state: "invalid" });
  });

  it("expiry is honored against the injected clock", () => {
    const { publicKeyPem, issue } = makeIssuer();
    const token = issue(payload({ expiresAt: "2026-07-10T00:00:00Z" }));
    expect(verifyLicense(token, publicKeyPem, Date.parse("2026-07-09T00:00:00Z")).state).toBe("valid");
    expect(verifyLicense(token, publicKeyPem, Date.parse("2026-07-11T00:00:00Z")).state).toBe("expired");
  });

  it("malformed tokens fail with a reason, never a throw", () => {
    const { publicKeyPem } = makeIssuer();
    for (const bad of ["", "abc", "a.b", "!!!.???"]) {
      const s = verifyLicense(bad, publicKeyPem);
      expect(s.state).toBe("invalid");
    }
  });
});

describe("edition provider", () => {
  it("Community is the default and claims nothing", () => {
    expect(edition()).toBe(communityProvider);
    expect(edition().edition()).toBe("community");
    expect(edition().has("scheduled-reports")).toBe(false);
    expect(edition().license()).toEqual({ state: "community" });
  });

  it("the repository ships no key material", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/extension/index.ts", "src/extension/license.ts"]) {
      const body = readFileSync(f, "utf8");
      expect(body).not.toContain("BEGIN PUBLIC KEY");
      expect(body).not.toContain("BEGIN PRIVATE KEY");
    }
  });
});
