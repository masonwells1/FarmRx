# Faketime artifact evidence

- Source manifest: `debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818`
- Synthetic tag: `maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic`
- Local repo digest: `maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746`
- Inspected image ID: `sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746`
- Exact labels: `farmrx.synthetic-bootstrap=225c197c34164c90b08a4c8b6b10e6c7`, `farmrx.synthetic-owner=maple-faketime-bootstrap`, `farmrx.synthetic-role=faketime-artifacts`, `farmrx.source-digest=debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818`, and `farmrx.package-contract=libfaketime=0.9.10-2.1;gcc;libc6-dev`.

Build command shape: `docker build --pull=false --label farmrx.synthetic-bootstrap=<token> -f tests/season/faketime-artifacts.Dockerfile -t <synthetic-tag> .`

The Debian manifest is pinned, but apt repository state is mutable. Governance begins only after the resulting artifact ID and exact labels are inspected and retained. This evidence accepts only the local artifact identity; it does not accept the frozen PostgreSQL build, runtime fixture lineage, or application behavior.

## Replacement record — 2026-08-13

The prior `225c197c34164c90b08a4c8b6b10e6c7` artifact above is historical evidence only. Its image ID `sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746` was intentionally removed as an exact synthetic proof artifact and is unrecoverable from a local export. No continuity, equivalence, or runtime credit is claimed for the replacement.

- New synthetic bootstrap token: `b9ad08aeb66ed961e8426b2cce527365`.
- Local tag: `maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365:synthetic`.
- Local repo digest and inspected ID: `maple-faketime-artifacts-b9ad08aeb66ed961e8426b2cce527365@sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302` and `sha256:7cbc0a183ba33c4318a9784dae376104e55282e8e0c716511336afaf924f3302`.
- Exact labels: `farmrx.synthetic-bootstrap=b9ad08aeb66ed961e8426b2cce527365`, `farmrx.synthetic-owner=maple-faketime-bootstrap`, `farmrx.synthetic-role=faketime-artifacts`, `farmrx.source-digest=debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818`, and `farmrx.package-contract=libfaketime=0.9.10-2.1;gcc;libc6-dev`.
- Durable local build evidence: `.playwright-local/connect-workflows-cw2-diagnostics/faketime-artifact-replacement-b9ad08aeb66ed961e8426b2cce527365/build.jsonl`, `stdout.log`, `stderr.log`, `build-input.json`, and `artifact-identity.json`. The native build exited `0`; zero containers referenced the artifact before use; it is not the ordinary PostgreSQL image.
- The Dockerfile build used `--pull=false` and cached layers. Its BuildKit diagnostics still recorded registry authentication/metadata activity, so this record does not claim an offline deterministic rebuild or immutable apt provenance beyond the pinned source digest and inspected result.
