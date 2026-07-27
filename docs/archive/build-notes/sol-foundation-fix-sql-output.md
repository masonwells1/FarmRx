Verification is blocked by current parallel `src/**` changes:

- TypeScript check failed with four errors, including optional crop-assignment `id` conflicting with required `{ id, is_new }`.
- Focused Supabase Fields regression failed in `writeQueue.ts` while parsing the queued envelope.
- SQL received static contract/dependency checks only; runtime database proof remains unperformed because database operations were prohibited.

I left all `src/**` files untouched.