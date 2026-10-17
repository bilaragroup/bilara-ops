#!/bin/bash
# Bilara TEST app on a DigitalOcean Droplet, NEXT TO anything already running there (e.g. the
# company website on nginx + port 3000). It never touches other services:
#   - its own service name:  bilara-test   (port 3100, localhost only)
#   - its own nginx site:    /etc/nginx/sites-available/bilara-test  (password + HTTPS via certbot)
#
#   cd /root/bilara-ops && git pull && sudo bash scripts/do-test-server.sh <password-for-testers>
#
# Copy your laptop's local data instead of demo data: stop the app on the laptop and here, then
# from the laptop:  scp -r .wrangler/state root@<droplet-ip>:/root/bilara-ops/.wrangler/
# and here:         sudo systemctl start bilara-test
#
# Anyone with the password can act as any role ("Testing as"). Test use only.
# Optional: DOMAIN=test.yourdomain.com (A record pointing here) — default <ip>.sslip.io
set -euo pipefail
PASS="${1:?Usage: sudo bash scripts/do-test-server.sh <password-for-testers>}"
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="$(stat -c %U "$APP_DIR")"
PORT=3100
IP="$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
DOMAIN="${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"

if ss -ltn | grep -q ":$PORT " && ! systemctl is-active -q bilara-test; then echo "Port $PORT is used by something else. Stopping."; exit 1; fi

echo "1/5  Packages (Node 22, nginx, certbot)…"
apt-get update -y
apt-get install -y curl git nginx openssl certbot python3-certbot-nginx
if ! node -v 2>/dev/null | grep -Eq '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
systemctl disable --now caddy 2>/dev/null || true

echo "2/5  App packages and local database…"
cd "$APP_DIR"
sudo -u "$APP_USER" npm install
sudo -u "$APP_USER" bash setup-local.sh

echo "3/5  App service (bilara-test, port $PORT)…"
cat > /etc/systemd/system/bilara-test.service <<EOF
[Unit]
Description=Bilara TEST app (port $PORT)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStartPre=/bin/rm -f $APP_DIR/.vinext/dev/lock.json
ExecStart=/usr/bin/npx vinext dev --port $PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable bilara-test
systemctl restart bilara-test

echo "4/5  nginx site with password + HTTPS for $DOMAIN…"
printf 'tester:%s\n' "$(openssl passwd -apr1 "$PASS")" > /etc/nginx/bilara-test.htpasswd
chmod 640 /etc/nginx/bilara-test.htpasswd; chgrp www-data /etc/nginx/bilara-test.htpasswd
cat > /etc/nginx/sites-available/bilara-test <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN;
  client_max_body_size 50m;
  auth_basic "Bilara test";
  auth_basic_user_file /etc/nginx/bilara-test.htpasswd;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host localhost:$PORT;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
  }
}
EOF
ln -sf /etc/nginx/sites-available/bilara-test /etc/nginx/sites-enabled/bilara-test
nginx -t
systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "HTTPS step failed; the site still works on http://$DOMAIN"

echo "5/5  Waiting for the app (first start compiles, can take a few minutes)…"
for i in $(seq 1 150); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'x-bilara-test-user-email: seedy@sites.test' http://localhost:$PORT/api/projects || true)
  [ "$code" = 200 ] && break; sleep 2
done
echo "App answered: $code"
if [ "${SEED:-1}" = 1 ]; then
  sudo -u "$APP_USER" env BILARA_URL=http://localhost:$PORT node scripts/seed-demo.mjs || echo "Demo data failed — run again: BILARA_URL=http://localhost:$PORT node scripts/seed-demo.mjs"
fi

echo ""
echo "Done.  Open https://$DOMAIN   user: tester   password: (the one you gave)"
echo "Update later:  cd $APP_DIR && git pull && sudo systemctl restart bilara-test"
