Implemented all Feature B review fixes. No commit made.

- P1: GDD now caps archive data at today − 5 days and rejects short, missing, corrupt, or partial history. The UI shows the honest history prompt instead of a number until coverage is complete.
- P2: Added shared DB-equivalent validation to form, repository, and queue parsing; offline saves return/display a `Pending sync` timeline row; mobile Field Log stacks safely and wraps unbroken notes.
- P2 regressions: added echo-mismatch, malformed queue, note-excluded rainfall total, GDD lag/partial/cache/future/fractional cases.
- P3: all Field Log text/control styles now have an 18px baseline; season/GDD text is explicitly 18px+.

Proof:

```text
npx.cmd tsc -b --force
Exit code: 0
```

```text
npm.cmd run build
✓ 145 modules transformed.
✓ built in 1.28s
PWA precache 6 entries
```

```text
npm.cmd run regression
SupabaseFieldLogRepository regression passed (7 coverage groups)
Weather service regressions passed (8 coverage groups)
```

`git diff --check` passed.

`git status --short` shows the pre-existing Feature B working tree plus the touched Field Log/weather files; no commit was created.

Deviation: PowerShell’s `npx` shim is broken on this machine, so I used the equivalent Windows `npx.cmd`. No dev server was run, as instructed. Build emits the existing non-blocking >500 kB chunk warning.