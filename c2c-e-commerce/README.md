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
| `EMBEDDING_PROVIDER` | no | `mock` under `NODE_ENV=test`, otherwise `local` | `local` runs the embedding model in-process; `mock` is deterministic and offline |
| `TRANSFORMERS_CACHE` | no | package-internal | Directory holding the embedding model files |

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

## Database migrations

Applied in order by `npm run db:migrate`, which reads `drizzle/meta/_journal.json` rather
than the directory listing — a `.sql` file without a journal entry is silently skipped.

| # | Migration | What it does |
|---|---|---|
| 0000 | `initial_schema` | Users, categories, listings, orders, order items, reviews |
| 0001 | `add_phone_number_to_users` | `users.phone_number` |
| 0002 | `add_rating_check_and_description_notnull` | Rating 1–5 constraint; `listings.description` NOT NULL |
| 0003 | `add_image_url_to_listings` | `listings.image_url` |
| 0004 | `add_approved_rejected_order_status` | `approved` and `rejected` order statuses |
| 0005 | `enable_pgvector` | `CREATE EXTENSION IF NOT EXISTS vector` |
| 0006 | `add_listing_embedding` | `listings.embedding vector(384)` (nullable), `listings.embedding_updated_at`, and the HNSW cosine index |

0005 and 0006 are hand-written: `drizzle-kit` emits neither `CREATE EXTENSION` nor an HNSW
index with an operator class. They are kept apart because installing an extension is a
database-level privilege operation and adding a column is not — on a managed host that
withholds the former, an administrator can apply 0005 out-of-band.

### Checking a deployed database for pgvector

Postgres must have the `vector` extension available. The compose files use
`pgvector/pgvector:pg16`, so local development needs no extra step. Before deploying, check
the managed database:

```bash
DATABASE_URL="<production url>" npm run db:check-pgvector
```

It reports whether the extension is available, whether the connecting role may install it,
and whether an HNSW index with `vector_cosine_ops` can be created. Exit code 0 means
migrations 0005 and 0006 will apply.

## Embeddings

Semantic search, "similar listings" and recommendations are all driven by 384-dimension
vectors produced by [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2),
run **in-process** through Transformers.js. There is no API key and no per-request cost.

The model is ~87 MB on disk and is downloaded on first use. Measured on this project:

| | |
|---|---|
| Cold load (download + init) | ~4.5 s |
| Warm load (cached on disk) | ~620 ms |
| Single embed, warm | ~7 ms |
| Batch of 8 vs. 8 sequential | 20 ms vs. 47 ms (2.4×) |

To avoid paying the download at runtime, the Docker image bakes the model in at build time:

```bash
TRANSFORMERS_CACHE=/app/.cache/transformers node scripts/prefetch-embedding-model.mjs
```

Run the same command locally before an offline demo. Set `EMBEDDING_PROVIDER=mock` to skip
the model entirely — the mock returns deterministic unit vectors of the same width, which
is what keeps the AI tests reproducible.

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
