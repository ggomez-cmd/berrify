export type AssetFetcher = {
  fetch: (request: Request) => Response | Promise<Response>;
};

export type WorkerEnv = {
  ASSETS: AssetFetcher;
  WHATSAPP_VERIFY_TOKEN?: string;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function methodNotAllowed(allow: readonly string[]): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: allow.join(", ") },
  });
}

function verifyWhatsApp(url: URL, env: WorkerEnv): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
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
    return env.ASSETS.fetch(request);
  },
};
