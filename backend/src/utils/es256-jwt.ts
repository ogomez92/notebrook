import { createSign } from "crypto";

const base64url = (input: Buffer | string): string =>
    Buffer.from(input).toString("base64url");

/**
 * Signs a compact JWT with ES256 (ECDSA over P-256, SHA-256) — the algorithm
 * APNs requires for token-based authentication. Kept dependency-free: node's
 * crypto can emit the raw `r || s` signature JOSE expects via `ieee-p1363`.
 */
export const signES256 = (
    header: Record<string, unknown>,
    claims: Record<string, unknown>,
    privateKeyPem: string
): string => {
    const encodedHeader = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", ...header }));
    const encodedClaims = base64url(JSON.stringify(claims));
    const signingInput = `${encodedHeader}.${encodedClaims}`;

    const signer = createSign("SHA256");
    signer.update(signingInput);
    const signature = signer.sign({ key: privateKeyPem, dsaEncoding: "ieee-p1363" });

    return `${signingInput}.${base64url(signature)}`;
};
