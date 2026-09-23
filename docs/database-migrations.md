# Applying a migration to the live database

Merging a pull request deploys the **client**. It never changes the **database**. Applying a
migration is a separate, deliberate act, and this document is how it is done.

Every migration in `supabase/migrations/` is written so that either order is safe: a client that
has deployed against an unapplied migration probes for what the database can do and falls back to
the old behaviour. That tolerance is what makes a manual apply safe, and it is why applying is not
automated on merge.

---

## One-time setup

### 1. Get the session pooler connection string

Supabase dashboard → project `agvsozfbstpekuqxpqjr` → **Connect** → **Session pooler**.

Copy the URI. It looks like:

```
postgresql://postgres.agvsozfbstpekuqxpqjr:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Replace `[YOUR-PASSWORD]` with the database password (dashboard → Settings → Database → reset it if
you do not have it; resetting is safe and affects nothing else).

Three things that will otherwise waste an afternoon:

- **It must be the *session* pooler, not the direct connection.** `db.<ref>.supabase.co` resolves
  to IPv6 only. GitHub's runners have no IPv6, so the direct string fails with a connection error
  that reads like a wrong password.
- **It must be the *session* pooler, not the *transaction* pooler on port 6543.** Migrations take
  advisory locks and run multi-statement transactions; transaction mode does not hold them.
- **The password must be percent-encoded** if it contains punctuation. `@` becomes `%40`, `#`
  becomes `%23`, `/` becomes `%2F`, `:` becomes `%3A`, `?` becomes `%3F`. A raw `@` in the
  password splits the URL in the wrong place and the error will not say so.

The workflow checks the first two of those and refuses with a plain-English message rather than
letting them turn into a confusing failure later.

### 2. Store it as a repository secret

GitHub → this repository → Settings → Secrets and variables → Actions → **New repository secret**.

- Name: `FARM_RX_SUPABASE_DB_URL`
- Value: the string from step 1

GitHub masks it in every log. It can be replaced or deleted at any time, and deleting it is the
complete off-switch for everything described here.

---

## Running it

Actions → **Database migrations** → *Run workflow*. Three modes.

### `status` — read only, always start here

Touches nothing. Prints three things:

1. **The history table.** `supabase_migrations.schema_migrations` — what the database believes has
   been applied. A migration pasted into the SQL Editor by hand does *not* appear here.
2. **What a push would do**, as a dry run.
3. **The live schema facts** LD-2 and LD-4 depend on, read from the catalog.

Read 1 against 3 before doing anything else. They can disagree, and the disagreement is the whole
reason `repair` exists.

### `repair` — fixes the history table, changes no schema

For the case where the schema change is genuinely present but the history table does not list it,
because it was applied by hand. Marking it applied stops the next push from trying to re-run it.

Requires the project ref typed into `confirm`, and a space-separated list of versions in
`repair_versions`, for example:

```
20260810223508 20260812135210 20260813133808
```

Only mark a version applied when `status` showed its schema is actually there. Marking something
applied that is not applied means it will be skipped forever.

### `apply` — runs the migrations

Requires the project ref typed into `confirm`. Applies every migration in `supabase/migrations/`
that the history table does not list, oldest first, then re-reads the catalog and prints what is
installed, so the run is its own proof.

---

## The first run, in order

1. **`status`.** Read it.
2. If the history table is empty or short while the schema is clearly further along — which is what
   applying by hand produces — **`repair`** the versions that are already present. `status` again.
3. **`apply`.**
4. **`status`** once more, and check the numbers the log tells you to expect.

Do not skip step 2 on a database whose migrations were applied by hand. A push against an empty
history table will try to re-run the very first migration and fail on `add column`.

---

## When something fails

The log names the failing migration and the SQL error. Migrations run one transaction per file, so
a failure rolls that file back; files before it stay applied and the history table records exactly
how far it got. Re-running after a fix resumes from there.

Nothing in this workflow drops or rewrites data. It only ever runs the files committed in
`supabase/migrations/`, which are reviewed in a pull request before they get here.
