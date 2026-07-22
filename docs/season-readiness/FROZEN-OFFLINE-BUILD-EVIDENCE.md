# Frozen PostgreSQL offline-build evidence

The artifact was pre-inspected against its exact reviewed ID and five labels before each build attempt.

- Rejected form: bare `sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746`; BuildKit treated it as `docker.io/library/sha256`.
- Rejected form: `maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7@sha256:4c4b06188e1c60639f6b7f3da7f1e6913e240a339ae305e7d9f60ccdb43ac746`; BuildKit attempted remote registry resolution.
- Successful form: exact pre-inspected local tag `maple-faketime-artifacts-225c197c34164c90b08a4c8b6b10e6c7:synthetic` with `--no-cache --network=none --pull=false`.
- Result image ID: `sha256:2012a39d6a620292e75bee5ac5e218bf9cc2c4ae1ae463a77f335a296b088858`.
- Owner label: `farmrx.synthetic-offline-proof=f7ca3c46fc164f7c83b634f850660c48`.
- Entrypoint: `["/usr/local/bin/frozen-postgres-entrypoint"]`.
- Command: `["postgres","-D","/etc/postgresql"]`.
- Frozen environment: `FROZEN_INSTANT=2027-07-09 21:10:00+00:00`.
- Cleanup: exact image identity and owner were rechecked, then the synthetic proof tag was removed without force.

This proves the frozen image can be built without network access from the pre-inspected local artifact tag. It does not accept runtime fixture lineage, database behavior, PostgREST routing, or the swap workflow.
