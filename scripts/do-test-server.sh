#!/bin/bash
# Bilara TEST server on a DigitalOcean Droplet (Ubuntu 22.04/24.04), for showing the app to testers.
#
#   git clone https://github.com/bilaragroup/bilara-ops.git && cd bilara-ops
#   sudo bash scripts/do-test-server.sh <password-for-testers>
#
# What it does: installs Node 22 and Caddy, runs the app with its own local database and file
# storage on this Droplet (the same way it runs on your laptop), loads the demo data, and puts it
# behind HTTPS with one shared password. Testers then switch person with "Testing as".
#
# DEMO DATA ONLY: anyone with the password can act as any role. Do not put real company data here.
# Optional: DOMAIN=test.yourdomain.com sudo -E bash scripts/do-test-server.sh <password>
#           (point the domain's A record at this Droplet first). Without it, <ip>.sslip.io is used.
set -euo pipefail
PASS="${1:?Usage: sudo bash scripts/do-test-server.sh <password-for-testers>}"
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="$(stat -c %U "$APP_DIR")"
IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
DOMAIN="${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"

echo "1/6  System packages…"
apt-get update -y
apt-get install -y curl git ufw gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "2/6  Node 22…"
if ! node -v 2>/dev/null | grep -Eq '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "3/6  Caddy (HTTPS + password)…"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "4/6  App packages and local database…"
cd "$APP_DIR"
sudo -u "$APP_USER" npm install
sudo -u "$APP_USER" bash setup-local.sh

echo "5/6  App service…"
cat > /etc/systemd/system/bilara.service <<EOF
[Unit]
Description=Bilara test app
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStartPre=/usr/bin/node scripts/stop-local.mjs
ExecStart=/usr/bin/npm run dev
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
HASH="$(caddy hash-password --plaintext "$PASS")"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  basic_auth {
    tester $HASH
  }
  # The app runs in its local test mode (Testing as); it is only reachable through this password.
  reverse_proxy localhost:3000 {
    header_up Host localhost:3000
  }
}
EOF
ufw allow OpenSSH >/dev/null; ufw allow 80 >/dev/null; ufw allow 443 >/dev/null; ufw --force enable >/dev/null
systemctl daemon-reload
systemctl enable --now bilara
systemctl restart caddy

echo "6/6  Waiting for the app, then loading demo data…"
for i in $(seq 1 90); do curl -fsS -o /dev/null http://localhost:3000/ && break; sleep 2; done
sudo -u "$APP_USER" env BILARA_URL=http://localhost:3000 node scripts/seed-demo.mjs || echo "Demo data step failed — run it again: BILARA_URL=http://localhost:3000 npm run seed:demo"

echo ""
echo "Done."
echo "  Open:      https://$DOMAIN"
echo "  Username:  tester"
echo "  Password:  (the one you gave)"
echo "  Then use 'Testing as' (bottom-left) to become PM, BOQ, Purchase, Audit, Accounts, Site Engineer…"
echo "  Update later:  cd $APP_DIR && git pull && sudo systemctl restart bilara"
