# @vercaemer/rate-limiting

**A no-dependencies minimal rate limiter for Cloudflare Durable Objects**

Currently it supports:
* Sliding Window Rate Limiting
* Multiple limits per request
* Caching limited keys to save usage

To do:
* Fixed Window Rate Limiting

See [example](./example) for usage.

# Contributing

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run src/index.ts
```

This project was created using `bun init` in bun v1.0.14. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
