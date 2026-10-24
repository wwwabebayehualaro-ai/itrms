/**
 * Development only (task 0.15): the object store behind /files, as Nginx serves it in production
 * (infra/compose/nginx/itrms.conf.template). A presigned URL is checked by the store for its own address, so the request
 * is sent on with the store's Host (fetch sets it from the URL); the same refusals as Nginx: no listing, no bucket
 * operation, no unsigned object request. In production this route answers 404: Nginx answers /files before the app.
 */
const UPSTREAM = process.env.NODE_ENV === 'development' ? process.env.FILES_UPSTREAM : undefined;
const FORWARDED = ['content-type', 'content-length', 'range'];
const RETURNED = ['content-type', 'content-length', 'content-disposition', 'content-range', 'etag', 'last-modified'];
const OPERATIONS = /(^|&)(uploads|list-type|delete|acl|policy|lifecycle|versioning|tagging)(=|&|$)/;

async function forward(request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
    if (!UPSTREAM) return new Response(null, { status: 404 });
    const { path } = await params;
    const url = new URL(request.url);
    const query = url.search.slice(1);
    const bucketOnly = path.length === 1;
    const allowed = bucketOnly
        ? request.method === 'POST' && query === ''
        : (request.method === 'GET' || request.method === 'HEAD' || request.method === 'PUT') &&
          /(^|&)X-Amz-Signature=/.test(query) &&
          !OPERATIONS.test(query);
    if (!allowed) return new Response(null, { status: 403 });

    const headers = new Headers();
    for (const name of FORWARDED) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    const target = `${UPSTREAM}/${path.map(encodeURIComponent).join('/')}${url.search}`;
    const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        // a request body streamed through (Node's fetch needs it said)
        ...(request.body ? { duplex: 'half' } : {}),
        redirect: 'manual'
    } as RequestInit);
    const out = new Headers();
    for (const name of RETURNED) {
        const value = upstream.headers.get(name);
        if (value) out.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { forward as GET, forward as HEAD, forward as POST, forward as PUT };
