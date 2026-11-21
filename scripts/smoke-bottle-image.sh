#!/usr/bin/env bash
# Disposable first-boot, persistence, permission and supervision checks. No real app data.
# CONTAINER_ENGINE=podman bash scripts/smoke-bottle-image.sh kept:bottle-dev
set -euo pipefail
image=${1:?usage: smoke-bottle-image.sh IMAGE}
engine=${CONTAINER_ENGINE:-docker}
app="kept-bottle-smoke-$(date +%s)-$$"
volume=$app-data
data=/data/app_data/kept-smoke
public_url=https://kept-smoke.example.org
cleanup() {
  local status=$?
  if ((status != 0)); then "$engine" logs --tail 60 "$app" >&2 || true; fi
  "$engine" rm -f "$app" >/dev/null 2>&1 || true
  "$engine" volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
fail() { echo "smoke-bottle: $*" >&2; exit 1; }

volumes=$("$engine" image inspect -f '{{json .Config.Volumes}}' "$image")
[[ $volumes == null || $volumes == '{}' ]] || fail "unexpected image volumes: $volumes"
"$engine" volume create "$volume" >/dev/null
start() {
  # No --init: test the entrypoint as PID 1, as on Bottle. Try to enable HA trust; it must lose.
  "$engine" run -d --name "$app" --memory=1g --cpus=1 -v "$volume:$data" \
    -e BOTTLE_APP_DATA_DIR="$data" -e BOTTLE_APP_NAME=kept-smoke -e BOTTLE_ZONE_DOMAIN=example.org \
    -e KEPT_HA=1 -e KEPT_HA_TRUST_GROUPS=1 -p 127.0.0.1::8080 "$image" >/dev/null
  local port deadline=$((SECONDS + ${BOOT_TIMEOUT:-180}))
  port=$("$engine" port "$app" 8080/tcp | sed -n '1s/.*://p')
  base=http://127.0.0.1:$port
  while ((SECONDS < deadline)); do
    [[ $("$engine" inspect -f '{{.State.Running}}' "$app") == true ]] || fail 'container exited during boot'
    if curl -fsS --max-time 2 "$base/readyz" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  fail 'readiness timed out'
}
stop() {
  "$engine" stop -t 30 "$app" >/dev/null
  [[ $("$engine" inspect -f '{{.State.ExitCode}}' "$app") == 0 ]] || fail 'unclean container exit'
  "$engine" logs "$app" 2>&1 | grep -q 'database system is shut down' || fail 'unclean PostgreSQL shutdown'
  "$engine" rm "$app" >/dev/null
}
state_hash() {
  "$engine" exec "$app" sha256sum "$data/config/secrets.json" "$data/config/database/kept_app" "$data/kept/smoke-file"
}

start
[[ $(curl -fsS "$base/api/v1/setup") == '{"needed":true}' ]] || fail 'setup missing or HA ingress enabled'
curl -fsS "$base/" | grep -qi '<!doctype html' || fail 'web UI missing'
"$engine" exec "$app" node /app/docker/healthcheck.mjs
code=$("$engine" logs "$app" 2>&1 | sed -n 's/^KEPT SETUP CODE: //p')
[[ -n $code ]] || fail 'no setup code'
status=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  -H "origin: $public_url" \
  -d "{\"code\":\"$code\",\"email\":\"smoke@example.org\",\"password\":\"correct horse battery\",\"displayName\":\"Smoke\"}" \
  "$base/api/v1/setup")
[[ $status == 201 ]] || fail "setup returned $status"
"$engine" exec --user 10001 "$app" sh -c 'printf persistent >"$1/kept/smoke-file"' sh "$data"
before=$(state_hash)
if "$engine" exec --user 10001 "$app" test -r "$data/owner/kept_owner"; then fail 'app can read database owner password'; fi
"$engine" exec "$app" test ! -e /run/kept-owner
[[ $("$engine" exec "$app" psql -h /run/postgresql -U postgres -d kept -Atc 'SHOW listen_addresses') == 127.0.0.1 ]] || fail 'database exposed beyond loopback'
[[ $("$engine" exec "$app" psql -h /run/postgresql -U postgres -d kept -Atc "SELECT count(*) FROM pg_extension WHERE extname IN ('vector', 'pg_trgm', 'unaccent')") == 3 ]] || fail 'required extensions missing'
stop
echo 'smoke-bottle: first boot, setup, database permissions and clean shutdown passed'

# Recreate the container with only the same persistent volume, as a platform rebuild would.
start
[[ $(curl -fsS "$base/api/v1/setup") == '{"needed":false}' ]] || fail 'setup lost on recreation'
[[ $(state_hash) == "$before" ]] || fail 'keys, database password or files changed'
status=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  -H "origin: $public_url" -d '{"email":"smoke@example.org","password":"correct horse battery"}' \
  "$base/api/v1/auth/sign-in/email")
[[ $status == 200 ]] || fail "sign-in after recreation returned $status"
stop
echo 'smoke-bottle: recreation preserves accounts, sign-in, keys and files'

# An unexpected database exit must stop the whole container so Bottle can detect the failure.
start
"$engine" exec "$app" setpriv --reuid=postgres --regid=postgres --init-groups -- \
  pg_ctl -D "$data/postgres" stop -m fast -w >/dev/null || true
# The entrypoint may exit before this exec returns, killing pg_ctl with it. Check the
# container's resulting state below, not the exit code of the intentionally interrupted exec.
deadline=$((SECONDS + 30))
while [[ $("$engine" inspect -f '{{.State.Running}}' "$app") == true ]]; do
  ((SECONDS < deadline)) || fail 'container survived database failure'
  sleep 1
done
[[ $("$engine" inspect -f '{{.State.ExitCode}}' "$app") == 1 ]] || fail 'database failure did not exit cleanly with status 1'
echo 'smoke-bottle: PASS (setup, login, persistence, database roles, health, shutdown, failure detection)'
