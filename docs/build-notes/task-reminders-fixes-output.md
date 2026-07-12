Implemented all requested Feature E review fixes. No commit made.

- PWA: restored cached `index.html` navigation fallback, `skipWaiting()`, and `clientsClaim()`; preserved push and click handlers. Generated `dist/sw.js` contains the precached `index.html` route plus activation calls.
- Mark-read: propagates `updated_count`; only full confirmations update locally. Zero/no-op reloads canonical state; offline actions remain pending.
- Bell count invalidates immediately after mark-read.
- Push: failed server persistence rolls back the browser subscription; turn-off compensates if browser unsubscribe fails.
- Push payloads now safely handle absent/null/invalid data and cap title/body.
- Default permission is shown as off, not denied.
- Notification CSS baseline is 18px+.
- Notifications regression expanded to 9 coverage groups.

Proof:

```text
.\node_modules\.bin\tsc.cmd -b --force
Exit code: 0

vite build
PWA v1.3.0
mode      injectManifest
precache  7 entries (881.91 KiB)
files generated
  dist/sw.js

SupabaseNotificationsRepository regression passed (9 coverage groups)
Weather service regressions passed (8 coverage groups)
```

The generated SW inspection confirmed `index.html` is in the precache and it registers `NavigationRoute(createHandlerBoundToURL('/index.html'))`, `skipWaiting()`, and `clientsClaim()`. I did not run a browser/offline session because you prohibited running a dev server.

Deviation: global `npx`/`npm` are broken before scripts start (`...Roaming\npm\node_modules\npm\bin\*-cli.js` missing), so I ran the exact repo-local equivalents for TypeScript, build, and all 14 regression scripts. All passed.

`git diff --check` passed. `git status` remains dirty with the pre-existing Feature E worktree changes; no files were committed.