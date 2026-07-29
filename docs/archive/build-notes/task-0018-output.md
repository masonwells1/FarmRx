Static verification passed: formatting, required security contract, farm-scoped update, grants, and absence of `SELECT ... FOR UPDATE`.

The migration remains unexecuted and its PostgreSQL syntax/runtime behavior is therefore unverified. This is intentional because the task explicitly prohibits running or applying SQL; the orchestrator must perform that verification during review.