// noinspection JSUnusedGlobalSymbols
export class RateLimiter {
    state;
    constructor(state, _env) {
        this.state = state;
    }
    fetch(request) {
        const now = Math.floor(Date.now() / 1000);
        const url = new URL(request.url);
        const key = url.searchParams.get("k");
        const rates = url.searchParams.getAll("r").map((r) => {
            const [limit, interval] = r.split(":", 2).map((n) => parseInt(n));
            return { limit, interval };
        });
        return this.slidingWindow(rates, key, now);
    }
    async slidingWindow(rates, key, now) {
        const bucket = `B/sliding/${key}`;
        const biggestInterval = Math.max(...rates.map((rate) => rate.interval));
        const requests = filterUntil(await this.state.storage
            .get(bucket)
            .then((requests) => requests ?? []), (request) => request + biggestInterval >= now);
        // TODO: the last request that goes through should also return a retry-after to be cached in further requests
        // that way we save extra limiter requests
        let retryAt = null;
        for (const rate of rates) {
            const { count, last } = countUntil(requests, (request) => request + rate.interval >= now);
            if (count >= rate.limit) {
                retryAt = Math.max(rate.interval + last, retryAt ?? 0);
            }
        }
        if (retryAt === null) {
            requests.unshift(now);
        }
        await this.state.storage.put(bucket, requests);
        if (retryAt === null) {
            return Response.json({ status: "OK" }, { status: 200 });
        }
        else {
            const maxAge = retryAt - now;
            return Response.json({ status: "LIMITED", retryAt }, {
                status: 200,
                headers: {
                    "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}, must-revalidate`,
                },
            });
        }
    }
}
/**
 * Apply rate limiting to the given key.
 */
export async function rateLimit(namespace, ctx, key, rates, options) {
    const id = namespace.idFromName(key);
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
        .json();
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
function filterUntil(array, predicate) {
    const values = [];
    for (const item of array) {
        if (predicate(item)) {
            values.push(item);
        }
        else {
            break;
        }
    }
    return values;
}
function countUntil(array, predicate) {
    let count = 0;
    let last;
    for (const item of array) {
        if (predicate(item)) {
            count++;
            last = item;
        }
        else {
            break;
        }
    }
    return { count, last };
}
