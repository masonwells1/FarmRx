Implemented all three findings.

- [MarketQuote.tsx](/C:/FarmRx/src/components/MarketQuote.tsx:17): iframe-observed watchdog, iframe load/error handling, 10s fallback, and full listener/observer/script/frame cleanup.
- [app.css](/C:/FarmRx/src/styles/app.css:205): shrinkable Grain grid track; one-column mobile widget grid; width constraints through iframe; labels now 18px.
- Data/repositories/envelope untouched; `git diff --check` passes.

`npm run build` tail:

```text
✓ built in 624ms
PWA v1.3.0
precache  6 entries (353.50 KiB)
```

`npm run regression` tail:

```text
MockFieldsRepository regressions passed.
MockGrainRepository regressions passed.
```

Note: the PowerShell `npm` shim is broken on this workstation, so I ran the equivalent installed `npm.cmd`. The browser confirmed all six widgets and TradingView attribution, but its localhost session was serving a stale external dev instance; direct access to the freshly built local bundle was blocked by browser policy, so the final 375px live scroll-width measurement could not be re-run here.