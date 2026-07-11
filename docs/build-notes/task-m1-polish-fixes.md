PRE-APPROVED TASK — do NOT ask for confirmation; EXECUTE end-to-end and report what you did.

# Task: Fix ALL findings in docs/review-module1-polish.md (Module 1 polish pass)

You are in C:\FarmRx. An adversarial review of the current uncommitted working tree found 4 P1 and 6 P2 issues. Read docs/review-module1-polish.md in full and fix EVERY finding, P1 and P2, exactly as the concrete fixes describe. Also re-read docs/design-brief-codex.md for the design rules.

Non-negotiable constraints while fixing:
- Finding 2 is the most dangerous: no Fields code path may EVER rewrite the shared localStorage envelope without preserving the grain compartment byte-for-byte. If the envelope is unparseable or an unknown version, fail closed (work from in-memory seed WITHOUT persisting over the stored value) — never destroy data to recover.
- Finding 1: persist() must throw on write failure; only report "Saved" after a confirmed write. Surface a visible inline error on failure and keep the user's typed values in the row.
- Finding 3: Records card must always offer "Add crop record"; enforce unique (year, commodity, sequence); never drop existing history.
- Finding 4: one field-level equivalent-rent result; base cash rent counted once; price must come from the manual planned price or an explicitly labeled source — never a silent arbitrary bid pick.
- Finding 8: make the regression EXECUTABLE and meaningful — add an npm script "regression" to package.json that runs BOTH src/data/MockFieldsRepository.regression.ts and src/data/MockGrainRepository.regression.ts via `npx tsx`, exiting nonzero on failure. Extend the fields regression to drive MockFieldsRepository.saveField() itself with a controlled fake storage: assert contact round-trip, grain compartment unchanged, write-failure propagation (no false success), corrupt-JSON and unknown-version envelopes leave stored data untouched, and close-and-insert arrangement history behavior.
- UI still talks only to the repository interface via src/data/index.ts. No new runtime dependencies (tsx as devDependency for the script is allowed only if npx alone doesn't work — prefer plain npx tsx with no install).
- TypeScript strict clean. Finish by running: npm run build AND the new npm run regression, and paste the tails of both outputs.

Report: every finding number → what you changed (file:line), plus the two command outputs.
