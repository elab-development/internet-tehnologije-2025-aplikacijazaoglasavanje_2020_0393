This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Environment variables

Copy `.env.example` to `.env.local` and fill it in. `.env.local` is never committed.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `JWT_SECRET` | yes | — | Signing key for access tokens (HS256) |
| `LLM_PROVIDER` | no | `mock` under `NODE_ENV=test`, otherwise `groq` | Which language-model provider to use: `groq` or `mock` |
| `GROQ_API_KEY` | when `LLM_PROVIDER=groq` | — | Groq API key |
| `GROQ_MODEL` | no | `qwen/qwen3.8-27b` | Open-weights model to call |
| `LLM_TIMEOUT_MS` | no | `15000` | Abort a completion that takes longer than this |

### Getting a free Groq API key

1. Sign up at [console.groq.com](https://console.groq.com) — the free tier needs no card.
2. Open [console.groq.com/keys](https://console.groq.com/keys) and create an API key.
3. Put it in `.env.local` as `GROQ_API_KEY=gsk_…` and set `LLM_PROVIDER=groq`.

The free tier allows roughly 30 requests per minute, which is why `LLM_TIMEOUT_MS`
exists and why AI endpoints are rate-limited.

A missing or blank `GROQ_API_KEY` makes the provider throw when it is constructed. It
does **not** fall back to the mock: a deployment that quietly serves fabricated
descriptions is a worse failure than one that refuses to start.

Set `LLM_PROVIDER=mock` to develop with no key and no network. The mock is deterministic —
the same prompt always yields the same text — which is what makes the AI tests reproducible.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Docker development (with live reload)

From the workspace root, run:

```bash
docker compose -f docker-compose.dev.yml up --build
```

This starts Next.js in development mode with polling enabled, which is more reliable for file watching on Windows bind mounts.

If you previously started production compose (`docker-compose.yml`), stop it first:

```bash
docker compose down
```

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
