-- C2C-AI-3 — enable pgvector.
--
-- Hand-written: drizzle-kit does not emit CREATE EXTENSION.
--
-- Kept separate from 0006 on purpose. Installing an extension is a database-level
-- privilege operation; adding a column is not. On a managed host that withholds the
-- former (risk R1), an administrator can apply this file out-of-band while 0006 still
-- runs as the ordinary application user.

CREATE EXTENSION IF NOT EXISTS vector;
