#!/usr/bin/env bash
# Cloudflare Bot Fight Mode + 기본 보안 레벨 (Zone API)
# 필요: CLOUDFLARE_API_TOKEN (Zone.Zone Settings Edit, Zone.Zone Read)
set -euo pipefail

ZONE_NAME="${CF_ZONE_NAME:-chikenmoo.dev}"
TOKEN="${CLOUDFLARE_API_TOKEN:-${CF_API_TOKEN:-}}"

if [[ -z "$TOKEN" ]]; then
  echo "CLOUDFLARE_API_TOKEN 없음 — 대시보드에서 수동으로 Bot Fight Mode 켜줘" >&2
  echo "  Security → Bots → Bot Fight Mode: On" >&2
  echo "  Security → Settings → Security Level: Medium+" >&2
  exit 2
fi

auth=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

zone_id=$(curl -fsS "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}" \
  "${auth[@]}" | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r["result"][0]["id"])')

echo "zone ${ZONE_NAME} = ${zone_id}"

patch() {
  local setting=$1 value=$2
  curl -fsS -X PATCH \
    "https://api.cloudflare.com/client/v4/zones/${zone_id}/settings/${setting}" \
    "${auth[@]}" \
    --data "{\"value\":\"${value}\"}" \
    | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r.get("success"), r.get("errors"), r.get("result",{}).get("id"), r.get("result",{}).get("value"))'
}

patch bot_fight_mode on || patch bot_fight_mode "on" || true
patch security_level medium
patch browser_check on
echo "done"
