# Worker Model Proof

The in-process collaboration surface does not expose a model selector, so the requested workers were launched with model-pinned headless `codex exec` sessions and closed stdin.

## Sol reconnaissance

- CLI model: `gpt-5.6-sol`
- CLI reasoning effort: `high`
- Sandbox: `read-only`
- Session: `019f6b5c-cb47-7e93-b74c-83b36ff1564c`
- Output: `SOL-RECON-OUTPUT.md`

## Terra reconnaissance

- CLI model: `gpt-5.6-terra`
- CLI reasoning effort: `medium`
- Sandbox: `read-only`
- Session: `019f6b5c-cb1f-74d1-bd59-6f1676417b47`
- Output: `TERRA-RECON-OUTPUT.md`

## Luna reconnaissance

- CLI model: `gpt-5.6-luna`
- CLI reasoning effort: `medium`
- Sandbox: `read-only`
- Session: `019f6b5c-cac5-7413-b773-7468c2e22826`
- Output: `LUNA-RECON-OUTPUT.md`

## Evidence interpretation

The Codex CLI startup header is the authoritative launch evidence for model and effort. Terra and Luna's prose reports describe the generic surface as GPT-5/Codex and do not independently expose the requested model name; they do not contradict the explicit CLI model pin shown above. No model was silently substituted.

## Sol Extra High reconciliation and validation

### Preliminary reconciliation

- CLI model: `gpt-5.6-sol`
- CLI reasoning effort: `xhigh`
- Initial sandbox: `read-only`
- Session: `019f6b68-eb8f-7851-9f7f-51ec2ecc3711`
- Output: `SOL-XHIGH-ORCHESTRATION-OUTPUT.md`

The initial turn stopped because generic in-session self-identification could not see the authoritative CLI header. A continuation of that same session produced the preliminary reconciliation, but the resume command reported `danger-full-access`; it performed read-only inspection only and is not the final sandbox proof.

### Final independent validation — authoritative

- CLI model: `gpt-5.6-sol`
- CLI reasoning effort: `xhigh`
- Sandbox: `read-only`
- Session: `019f6b76-2d67-7752-a1e2-3c23fee90548`
- Output: `RECONCILED-SLICE-PLAN.md`

The fresh validation session completed entirely under the requested read-only sandbox. Its CLI header is the authoritative Sol Extra High orchestration proof, and its output supersedes the preliminary reconciliation wherever they differ.
