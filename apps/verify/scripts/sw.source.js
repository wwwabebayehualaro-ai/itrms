// The verifier's service worker (ADR-0024, ADR-0046): everything the app is, cached at install, so it opens in flight mode. A
// document's status and the keys are never cached here: an old answer about a document would be worse than none.
import { Serwist } from 'serwist';

const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    skipWaiting: true,
    clientsClaim: true
});

// every /<token> is the same static page, which reads the token from its address
serwist.registerCapture(
    ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
    async ({ request }) => (await serwist.matchPrecache('/index.html')) ?? fetch(request)
);

serwist.addEventListeners();
