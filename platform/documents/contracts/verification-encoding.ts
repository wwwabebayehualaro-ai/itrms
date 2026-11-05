/** A QR's encodings. On their own so the verifier PWA takes these and nothing else of the contracts. */
export const encodeBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

export const decodeBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

/**
 * What the signature covers: the token and the payload. A revoked document's facts beside another document's token fail offline as
 * well as online, and the token adds nothing to the QR, because it is in the address already.
 */
export const signedBytes = (token: string, payload: Uint8Array): Uint8Array<ArrayBuffer> => {
    const prefix = new TextEncoder().encode(`${token}.`);
    const bytes = new Uint8Array(prefix.length + payload.length);
    bytes.set(prefix);
    bytes.set(payload, prefix.length);
    return bytes;
};
