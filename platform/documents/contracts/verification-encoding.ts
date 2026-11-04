/** Base64url, for a QR's text. On its own so the verifier PWA takes these and nothing else of the contracts. */
export const encodeBase64Url = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

export const decodeBase64Url = (text: string): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
