#!/usr/bin/env bash
# Sync math-tutor to pi@raspberrypi and (re)start the service.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-pi@raspberrypi}"
REMOTE_DIR="${DEPLOY_DIR:-/home/pi/math-tutor}"

rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude datasets/aihub-71859 \
  --exclude '*.log' \
  "$ROOT/" "$HOST:$REMOTE_DIR/"

if [[ -f "$ROOT/.env.local" ]]; then
  scp -q "$ROOT/.env.local" "$HOST:$REMOTE_DIR/.env.local"
  echo "synced .env.local"
else
  echo "warning: .env.local missing locally" >&2
fi

ssh "$HOST" "REMOTE_DIR=$REMOTE_DIR bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

npm install
sudo docker compose up -d

for i in $(seq 1 40); do
  if sudo docker compose exec -T db pg_isready -U math -d math_tutor >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

npm run db:migrate
npm run db:seed

count=$(sudo docker compose exec -T db psql -U math -d math_tutor -tAc "select count(*) from problems" 2>/dev/null || echo 0)
count=${count//[[:space:]]/}
if [[ "$count" == "0" ]]; then
  echo "ingesting problems..."
  npm run db:ingest
fi

npm run build

NPM=$(command -v npm)
sudo cp deploy/math-tutor.service /etc/systemd/system/math-tutor.service
sudo sed -i "s|^WorkingDirectory=.*|WorkingDirectory=${REMOTE_DIR}|" /etc/systemd/system/math-tutor.service
sudo sed -i "s|^ExecStart=.*|ExecStart=${NPM} run start|" /etc/systemd/system/math-tutor.service
sudo systemctl daemon-reload
sudo systemctl enable --now math-tutor.service
sudo systemctl restart math-tutor.service
sleep 2
curl -fsS "http://127.0.0.1:3001/api/health"
echo
sudo systemctl --no-pager --full status math-tutor.service | head -20
REMOTE
