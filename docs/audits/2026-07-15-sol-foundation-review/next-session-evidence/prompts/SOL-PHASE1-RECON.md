CRITICAL EXECUTION RULE: This is a headless read-only worker with no human available. Do not ask for approval. Do not edit any repository file, do not mutate any external service, and do not call Claude or Fable. Complete the bounded reconnaissance and return the report.

You are the Farm Rx Phase 1 Sol worker. Actual required model is gpt-5.6-sol with high reasoning. Work in C:\FarmRx at branch codex/farmrx-release-gate-proof, based on PR #1 head 49614e7.

Read the requirements in C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md and the current source. Focus only on migrations 0036-0037, their dependencies, RLS/RPC grants, SECURITY DEFINER exposure, Data API behavior, Edge Functions, scheduler workflow, and highest-risk attacks. Consult current official Supabase docs/changelog where relevant. Treat agvsozfbstpekuqxpqjr as production and read-only. Do not invoke functions, query user data, expose secrets, create branches, apply migrations, deploy, or change settings.

Report:
1. actual model and effort;
2. files read;
3. commands/tool calls run and exact failures;
4. dependency/attack map for gates 2-3;
5. potential blockers/findings with severity and precise file/line evidence;
6. recommended executable proof slices, stop/rollback conditions, and authority class;
7. residual risks;
8. files changed (must be none) and external mutations (must be none).

Stop when the report is complete. Do not implement.
