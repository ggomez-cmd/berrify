/** Cloudflare Workers throw Illegal invocation when `fetch` is called unbound. */
export function boundFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export function boundAssetFetch(
  assets: { fetch: (request: Request) => Response | Promise<Response> },
  request: Request,
): Response | Promise<Response> {
  return assets.fetch.call(assets, request);
}
