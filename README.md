# Primark Safety Passport

Primark Safety Passport migrated from the current prototype (version 15, source
`3aec70bb525fc8a0497b31a1e00ed74031c9b8ff`) to Next.js on Netlify.

## Import into Netlify

1. Add a new project → Import an existing project → GitHub → `simondotjones-sudo/Primark`.
2. Use the `main` branch. The repository's `netlify.toml` supplies the settings:
   - Framework: Next.js
   - Build command: `pnpm build`
   - Publish directory: `.next`
   - Node.js: 22
   - Base directory: leave empty
3. Add these environment variables, available to Functions (or all scopes):
   - `PRIMARK_ADMIN_EMAIL`: the email you want to use for platform admin.
   - `PRIMARK_ADMIN_PASSWORD`: a unique password of at least 16 characters. Mark it secret.
   Set different credentials for deploy previews if you enable them.
4. Deploy. `@netlify/database` provisions Netlify Database and applies the SQL in
   `netlify/database/migrations/001_initial-schema/migration.sql`. Netlify Blobs
   stores uploaded course files and photos automatically.
5. Open `/admin/sign-in`, create a course, upload a SCORM 1.2 ZIP, select its audience
   and publish. Learners join from the home page and retain their personal pass code.

No manually created Neon project or database connection string is needed.
If database provisioning needs attention, open Data & Storage → Database in Netlify.
Netlify detects and installs its Next.js adapter automatically.

## Included

- Existing Primark design, Gellix fonts, country/store directory and translations.
- Learner registration, pass codes, saved progress, assessment, PDF printing and QR verification.
- Platform-admin course creation, SCORM 1.2 validation, previews and deployment to users,
  countries and sites, including future matching joiners.
- SCORM resume state, completion, scores, time tracking and the latest nested-frame fix.
- Admin reports, CSV export/import and photo shot-list uploads.
- PostgreSQL migrations, transactional database adapter, admin sign-in and session revocation.
- Chunked uploads (2 MiB requests), plus authenticated Edge Function file streaming and byte ranges.

## Data and access

This is a source migration. The initial Netlify database is empty. The existing prototype,
its database and uploaded SCORM packages/photos remain unchanged. Source assets such as the
chapter-one video are included, but prototype learner records, credentials, assignments,
progress and dynamically uploaded files are not committed. Transfer those privately after
the Netlify project is available, if required; never put database exports into this public repo.

Admin access uses the server-configured email/password, not learner registration or headers
from the old host. Admin sessions last eight hours, are stored as hashed tokens in Postgres,
and are revoked by logout or changing the configured credentials. Login attempts are rate
limited. Never put real admin credentials in committed files or `NEXT_PUBLIC_*` variables.

Production uploads survive deployments. Preview branches write to separate blob stores;
they may read immutable production files referenced by their copied database. Build-time
context is embedded by `scripts/build-context.mjs`; it contains no secrets.

SCORM packages execute JavaScript. Only upload trusted authoring-tool exports. The existing
same-origin frame support is retained because many SCORM 1.2 players require it.

Email pass-code recovery and approved final learning content remain separate launch tasks.
Only chapter one currently has a video; the other chapters retain their existing sample
content. Country/site reporting scopes are admin filters, not delegated manager roles.
The photo collection workspace retains its existing shared access for signed-in learners.

## Develop and verify

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm typecheck
pnpm build
```

`pnpm dev` runs Netlify Dev with its local database/blob emulation. Copy `.env.example`
to `.env` for local admin access. Never commit `.env`.

Tests use an isolated in-memory PostgreSQL engine (PGlite) and simulated blob storage.
The 27 checks cover course publication/assignment, SCORM saving/resume, transaction rollback,
admin authentication, learner registration/completion, multipart photos and streamed reads.
The build and these checks do not substitute for a smoke test on the first Netlify deploy:
register a test learner, publish a small test SCORM course, save/reopen it, check reporting,
and upload/download a photo. No Netlify deployment was created by the source migration.
