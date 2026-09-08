export type AssetFetcher = {
  fetch: (request: Request) => Response | Promise<Response>;
};

export type WorkerEnv = {
  ASSETS: AssetFetcher;
  WHATSAPP_VERIFY_TOKEN?: string;
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const HTML_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  const type = headers.get("content-type") ?? "";
  headers.set("Content-Security-Policy", type.includes("text/html") ? HTML_CSP : API_CSP);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body: unknown, status = 200): Response {
  return withSecurityHeaders(Response.json(body, { status }));
}

function methodNotAllowed(allow: readonly string[]): Response {
  return withSecurityHeaders(
    new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: allow.join(", ") },
    }),
  );
}

function verifyWhatsApp(url: URL, env: WorkerEnv): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return withSecurityHeaders(new Response(challenge, { status: 200 }));
  }
  return withSecurityHeaders(new Response("Forbidden", { status: 403 }));
}

function apiPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export async function handleApi(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = apiPath(url.pathname);

  if (path === "/api/health") {
    switch (request.method) {
      case "GET":
      case "HEAD":
        return json({ ok: true, service: "berrify" });
      default: {
        return methodNotAllowed(["GET", "HEAD"]);
      }
    }
  }

  if (path === "/api/webhooks/whatsapp") {
    switch (request.method) {
      case "GET":
        return verifyWhatsApp(url, env);
      case "POST":
        return json(
          {
            ok: false,
            error: "WhatsApp Cloud API ingest is not wired on this Worker yet. Use npm run whatsapp:ingest.",
          },
          501,
        );
      default: {
        return methodNotAllowed(["GET", "POST"]);
      }
    }
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const path = apiPath(new URL(request.url).pathname);
    if (path === "/api" || path.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
