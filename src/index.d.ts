/// <reference types="@cloudflare/workers-types" />
interface Rate {
    limit: number;
    interval: number;
}
export declare class RateLimiter {
    private readonly state;
    constructor(state: DurableObjectState, _env: unknown);
    fetch(request: Request): Promise<Response>;
    private slidingWindow;
}
/**
 * Apply rate limiting to the given key.
 */
export declare function rateLimit(namespace: DurableObjectNamespace, ctx: ExecutionContext, key: string, rates: Rate[], options?: {
    cacheName?: string;
}): Promise<Response | null>;
export {};
