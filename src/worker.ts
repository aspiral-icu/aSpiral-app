// Minimal Cloudflare Worker entrypoint for static asset routing
// Serves static assets from dist/ via env.ASSETS

interface Env {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
