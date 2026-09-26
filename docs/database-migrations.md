# Applying a migration to the live database

Merging a pull request deploys the **client**. It never changes the **database**. Applying a
migration is a separate, deliberate act, and this document is how it is done.

Every migration in `supabase/migrations/` is written so that either order is safe: a client that
has deployed against an unapplied migration probes for what the database can do and falls back to
the old behaviour. That tolerance is what makes a manual apply safe, and it is why applying is not
automated on merge.

The Supabase connector is the route when an agent applies one; the GitHub workflow further down is
the fallback for a session that has no connector. Either way it is a live migration, and the
approval rule in `AGENTS.md` applies.

---

## Primary route: the Supabase connector

An agent with the Supabase connector (`execute_sql` on project `agvsozfbstpekuqxpqjr`) needs no
password and no secret. `scripts/live-migration-sql.mjs` prints the exact SQL; the agent runs it.

1. **Status.** `node scripts/live-migration-sql.mjs status` prints a query listing every file in
   `supabase/migrations/` beside whether the live history records it. Run it. On 2026-09-26 all 60
   files were recorded, so after that date anything unrecorded is a genuinely new migration.
2. **Apply, oldest first, one per call.** For each unrecorded version,
   `node scripts/live-migration-sql.mjs apply <version>` prints one `do` block. Run it. Stop at the
   first error and report it; do not skip ahead.
3. **Check.** Run status again, then the connector's security and performance advisors, and read
   any finding that names an object the migration created.

What the printed block guarantees, so none of it has to be re-derived by hand:

- **The file is run exactly as committed.** The block carries the file's md5 and refuses to run
  unless the text that reached the database has the same one, so a transcription slip changes
  nothing.
- **All or nothing.** The file and its history row run in one transaction; a failure leaves the
  database as it was.
- **Recorded under its real version.** Do not use the connector's `apply_migration` tool. It
  records the time it ran rather than the file's version, and the live history then disagrees with
  the repository forever.
- **Never twice.** A version the history already records is refused before anything runs.

A migration whose file must run outside a transaction (`create index concurrently`,
`alter type ... add value`) cannot go through this block. None does today; one that does is
applied by the workflow below instead.

---

## Fallback: one-time setup for the GitHub workflow

### 1. Get the session pooler connection string

Supabase dashboard → project `agvsozfbstpekuqxpqjr` → **Connect** → **Session pooler**.

Copy the URI. It looks like:

```
postgresql://postgres.agvsozfbstpekuqxpqjr:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
```

The green **Connect** button sits near the top of the project page, and the panel it opens has
three nearly identical boxes. **Session pooler** is the one.

Replace `[YOUR-PASSWORD]`, square brackets included, with the database password.

If you do not have it: dashboard → **Settings → Database → Database password → Reset**. Resetting
is safe and breaks nothing, because **Farm Rx itself never uses this password** — the app connects
with the anon key and the edge functions use the service role key. The new password is shown once.

Three things that will otherwise waste an afternoon:

- **It must be the *session* pooler, not the direct connection.** `db.<ref>.supabase.co` resolves
  to IPv6 only. GitHub's runners have no IPv6, so the direct string fails with a connection error
  that reads like a wrong password.
- **It must be the *session* pooler, not the *transaction* pooler on port 6543.** Migrations take
  advisory locks and run multi-statement transactions; transaction mode does not hold them.
- **The password must be percent-encoded** if it contains punctuation. A raw `@` splits the URL at
  the wrong place and the error will not say so.

  | in the password | write instead |
  | --- | --- |
  | `@` | `%40` |
  | `#` | `%23` |
  | `/` | `%2F` |
  | `:` | `%3A` |
  | `?` | `%3F` |
  | `&` | `%26` |
  | `%` | `%25` |

  Letters and digits need nothing. A freshly reset password is usually letters and digits only,
  in which case none of this applies.

The workflow checks the first two of those and refuses with a plain-English message rather than
letting them turn into a confusing failure later.

### 2. Store it as a repository secret

Straight to the form:
<https://github.com/masonwells1/FarmRx/settings/secrets/actions/new>
(or: repository → Settings → Secrets and variables → Actions → **New repository secret**).

| box | value |
| --- | --- |
| **Name** | `FARM_RX_SUPABASE_DB_URL` — exactly, capitals and underscores |
| **Secret** | the string from step 1 |

The connection string goes from Supabase into that box directly. It should not be pasted into a
chat, an issue, or a commit on the way.

GitHub encrypts it on submission and masks it in every log; nobody, including whoever set it, can
read it back afterwards. Deleting it at
<https://github.com/masonwells1/FarmRx/settings/secrets/actions> is the complete off-switch for
everything described here.

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
