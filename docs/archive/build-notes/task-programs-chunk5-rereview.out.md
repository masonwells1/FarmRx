Re-review complete with a **BLOCK** verdict.

Report: [task-programs-chunk5-rereview.out.md](C:\FarmRx\docs\build-notes\task-programs-chunk5-rereview.out.md)

Main blockers:

- Link verification still trusts client-supplied canonical values.
- Program-linked Inventory rows lack repository-level farm validation.
- Product-less Program drafts are not rendered.
- Regressions do not detect these gaps.

`tsc`, build, and all regressions passed. No code or migrations were edited.