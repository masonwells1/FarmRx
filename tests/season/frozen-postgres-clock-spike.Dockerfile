ARG FAKETIME_ARTIFACTS_IMAGE
ARG BASE_IMAGE=public.ecr.aws/supabase/postgres@sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5
FROM ${FAKETIME_ARTIFACTS_IMAGE} AS faketime-artifacts

FROM ${BASE_IMAGE}

USER root
COPY --from=faketime-artifacts /artifacts/libfaketime.so.1 /usr/local/lib/faketime/libfaketime.so.1
COPY --from=faketime-artifacts /artifacts/libclear-ld-preload.so /usr/local/lib/faketime/libclear-ld-preload.so
RUN test -r /usr/local/lib/faketime/libfaketime.so.1 \
 && test -r /usr/local/lib/faketime/libclear-ld-preload.so

ARG FROZEN_INSTANT
RUN test -n "${FROZEN_INSTANT}"
ENV FROZEN_INSTANT=${FROZEN_INSTANT}

COPY tests/season/frozen-postgres-entrypoint.sh /usr/local/bin/frozen-postgres-entrypoint
RUN chmod 0755 /usr/local/bin/frozen-postgres-entrypoint
ENTRYPOINT ["/usr/local/bin/frozen-postgres-entrypoint"]
CMD ["postgres", "-D", "/etc/postgresql"]

# Feasibility contract only: the wrapper refuses an empty data directory and
# applies libfaketime only to the final PostgreSQL server, never the init shell.
