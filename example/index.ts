import { rateLimit } from "@vercaemer/rate-limiter";
export { RateLimiter } from "@vercaemer/rate-limiter";

declare global {
  interface Env {
    Limiter: DurableObjectNamespace;
  }
}

// noinspection JSUnusedGlobalSymbols
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const limited = await rateLimit(env.Limiter, ctx, "0", [
      { limit: 3, interval: 10 },
    ]);
    if (limited) {
      return limited;
    }

    return new Response("OK!");
  },
};
