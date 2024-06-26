export interface Rate {
  limit: number;
  interval: number;
}

// noinspection JSUnusedGlobalSymbols
export class RateLimiter {
  constructor(
    private readonly state: DurableObjectState,
    _env: unknown,
  ) {}

  fetch(request: Request): Promise<Response> {
    const now = Math.floor(Date.now() / 1000);
    const url = new URL(request.url);
    const key = url.searchParams.get("k")!;
    const rates = url.searchParams.getAll("r")!.map((r) => {
      const [limit, interval] = r.split(":", 2).map((n) => parseInt(n));
      return <Rate>{ limit, interval };
    });

    return this.slidingWindow(rates, key, now);
  }

  private async slidingWindow(
    rates: Rate[],
    key: string,
    now: number,
  ): Promise<Response> {
    const bucket = `B/sliding/${key}`;
    const biggestInterval = Math.max(...rates.map((rate) => rate.interval));
    const requests = filterUntil(
      await this.state.storage
        .get<number[]>(bucket)
        .then((requests) => requests ?? []),
      (request) => request + biggestInterval >= now,
    );

    // TODO: the last request that goes through should also return a retry-after to be cached in further requests
    // that way we save extra limiter requests
    let retryAt: number | null = null;
    for (const rate of rates) {
      const { count, last } = countUntil(
        requests,
        (request) => request + rate.interval >= now,
      );
      if (count >= rate.limit) {
        retryAt = Math.max(rate.interval + last!, retryAt ?? 0);
      }
    }

    if (retryAt === null) {
      requests.unshift(now);
    }

    await this.state.storage.put(bucket, requests);

    if (retryAt === null) {
      return Response.json({ status: "OK" }, { status: 200 });
    } else {
      const maxAge = retryAt - now;
      return Response.json(
        { status: "LIMITED", retryAt },
        {
          status: 200,
          headers: {
            "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, must-revalidate`,
          },
        },
      );
    }
  }
}

/**
 * Apply rate limiting to the given key.
 * @param namespace The Durable Object binding
 * @param ctx Worker Execution Context
 * @param name Which durable object to use
 * @param key Request key
 * @param rates The array of rates to enforce for the request. This array should be stable across requests
 * with the same key.
 * @param options Other options
 */
export async function rateLimit(
  namespace: DurableObjectNamespace,
  ctx: ExecutionContext,
  name: string,
  key: string,
  rates: Rate[],
  options?: {
    cacheName?: string;
  },
): Promise<Response | null> {
  const id = namespace.idFromName(name);
  const limiter = namespace.get(id);
  const url = new URL("http://rate-limiter");
  const cache = await caches.open(options?.cacheName ?? "rate-limiter");
  url.searchParams.set("k", key);
  rates.forEach((r) => {
    url.searchParams.append("r", `${r.limit}:${r.interval}`);
  });

  const cached = await cache.match(url);
  const response = cached ?? (await limiter.fetch(url));
  const data = await response
    .clone()
    .json<{ status: "OK" } | { status: "LIMITED"; retryAt: number }>();

  if (data.status === "OK") {
    return null;
  }

  if (!cached && response.headers.has("cache-control")) {
    ctx.waitUntil(cache.put(url, response));
  }

  return new Response(null, {
    status: 429,
    headers: {
      "Retry-After": (data.retryAt - Math.ceil(Date.now() / 1000)).toString(),
    },
  });
}

/**
 * By default, distributes requests to Durable Objects by client IP. If you want to allow requests with no IP, add
 * RATE_LIMITER_ALLOW_MISSING_IP=true to your env.
 * @param namespace Durable Object Binding name in the Env
 * @param rates Array of rates to enforce.
 * @param key Request key. If missing, use client ip.
 */
export function withRateLimiter<
  N extends string,
  R extends Request,
  E extends { [P in N]: DurableObjectNamespace } & { [K in string]: any },
>(
  namespace: N,
  rates:
    | Rate[]
    | ((
        request: R,
        env: E,
        ctx: ExecutionContext,
      ) => Rate[] | Promise<Rate[]> | Response | Promise<Response>),
  key?:
    | string
    | ((
        request: R,
        env: E,
        ctx: ExecutionContext,
      ) => string | Promise<string> | Response | Promise<Response>),
) {
  return async function (request: R, env: E, ctx: ExecutionContext) {
    const ip = request.headers.get("CF-Connecting-IP");
    if (ip === null && !env["RATE_LIMITER_ALLOW_MISSING_IP"]) {
      return new Response("Missing client ip", { status: 403 });
    }
    const key_ = typeof key === "function" ? await key(request, env, ctx) : key;
    if (key_ instanceof Response) {
      return key_;
    }
    const rates_ =
      typeof rates === "function" ? await rates(request, env, ctx) : rates;
    if (rates_ instanceof Response) {
      return rates_;
    }
    const limited = await rateLimit(
      env[namespace],
      ctx,
      ip ?? "127.0.0.1",
      key_ ?? ip ?? "127.0.0.1",
      rates_,
    );
    if (limited) {
      return limited;
    }
  };
}

function filterUntil<T>(array: T[], predicate: (t: T) => boolean): T[] {
  const values = [];
  for (const item of array) {
    if (predicate(item)) {
      values.push(item);
    } else {
      break;
    }
  }
  return values;
}

function countUntil<T>(
  array: T[],
  predicate: (t: T) => boolean,
): { count: number; last: T | undefined } {
  let count = 0;
  let last;
  for (const item of array) {
    if (predicate(item)) {
      count++;
      last = item;
    } else {
      break;
    }
  }
  return { count, last };
}
