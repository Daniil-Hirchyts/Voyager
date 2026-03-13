#!/bin/sh
set -eu

child_pid=""

forward_signal() {
  if [ -n "${child_pid}" ] && kill -0 "${child_pid}" 2>/dev/null; then
    kill "${child_pid}"
  fi
}

trap forward_signal INT TERM

/opt/keycloak/bin/kc.sh "$@" &
child_pid=$!

admin_user="${KC_BOOTSTRAP_ADMIN_USERNAME:-${KEYCLOAK_ADMIN:-admin}}"
admin_password="${KC_BOOTSTRAP_ADMIN_PASSWORD:-${KEYCLOAK_ADMIN_PASSWORD:-admin}}"
server_url="http://127.0.0.1:8080"

attempts=0
until /opt/keycloak/bin/kcadm.sh config credentials \
  --server "${server_url}" \
  --realm master \
  --user "${admin_user}" \
  --password "${admin_password}" >/dev/null 2>&1
do
  attempts=$((attempts + 1))

  if ! kill -0 "${child_pid}" 2>/dev/null; then
    wait "${child_pid}"
    exit 1
  fi

  if [ "${attempts}" -ge 90 ]; then
    echo "Voyager theme bootstrap timed out waiting for Keycloak." >&2
    wait "${child_pid}"
    exit 1
  fi

  sleep 2
done

reset_master_theme() {
  if /opt/keycloak/bin/kcadm.sh get "realms/master" >/dev/null 2>&1; then
    /opt/keycloak/bin/kcadm.sh update "realms/master" \
      -s loginTheme=keycloak \
      -s accountTheme=keycloak.v3 \
      -s adminTheme=keycloak.v2 \
      -s emailTheme=keycloak >/dev/null
  fi
}

apply_travel_theme() {
  if /opt/keycloak/bin/kcadm.sh get "realms/travel" >/dev/null 2>&1; then
    /opt/keycloak/bin/kcadm.sh update "realms/travel" \
      -s loginTheme=voyager \
      -s accountTheme=voyager \
      -s adminTheme=keycloak.v2 \
      -s emailTheme=voyager >/dev/null
  fi
}

reset_master_theme
apply_travel_theme

wait "${child_pid}"
