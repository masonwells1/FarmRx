ARG FAKETIME_BUILDER=debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818
ARG BASE_IMAGE=public.ecr.aws/supabase/postgres@sha256:9faa7279bcf1fd6834e65dc876b11e39cb53030bcb3d653beb7e5668200acbb5
FROM ${FAKETIME_BUILDER} AS faketime-builder
COPY tests/season/clear-ld-preload.c /tmp/clear-ld-preload.c
RUN apt-get update \
 && apt-get install -y --no-install-recommends libfaketime=0.9.10-2.1 gcc libc6-dev \
 && test -r /usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1 \
 && gcc -shared -fPIC -O2 -o /tmp/libclear-ld-preload.so /tmp/clear-ld-preload.c \
 && rm -rf /var/lib/apt/lists/*

FROM ${BASE_IMAGE}

USER root
COPY --from=faketime-builder /usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1 /usr/local/lib/faketime/libfaketime.so.1
COPY --from=faketime-builder /tmp/libclear-ld-preload.so /usr/local/lib/faketime/libclear-ld-preload.so
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
