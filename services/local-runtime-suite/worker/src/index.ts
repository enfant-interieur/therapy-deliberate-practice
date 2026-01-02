export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> {
    return new Response("Static assets should be served by Cloudflare Pages/Workers assets.");
  },
};
