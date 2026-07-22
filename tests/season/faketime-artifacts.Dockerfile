FROM debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818 AS build

COPY tests/season/clear-ld-preload.c /tmp/clear-ld-preload.c
RUN apt-get update \
 && apt-get install -y --no-install-recommends libfaketime=0.9.10-2.1 gcc libc6-dev \
 && test -r /usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1 \
 && gcc -shared -fPIC -O2 -o /tmp/libclear-ld-preload.so /tmp/clear-ld-preload.c \
 && test -s /tmp/libclear-ld-preload.so

FROM scratch
LABEL farmrx.synthetic-owner="maple-faketime-bootstrap" \
      farmrx.synthetic-role="faketime-artifacts" \
      farmrx.source-digest="debian@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818" \
      farmrx.package-contract="libfaketime=0.9.10-2.1;gcc;libc6-dev"
COPY --from=build /usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1 /artifacts/libfaketime.so.1
COPY --from=build /tmp/libclear-ld-preload.so /artifacts/libclear-ld-preload.so
