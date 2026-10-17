#!/bin/bash
# Puts back the service file of the program already running as "bilara" on this Droplet (the
# company website), which an earlier version of do-test-server.sh overwrote. It rebuilds the file
# from the RUNNING process (program, folder, user, environment), checks a copy starts on a spare
# port, and does NOT restart the website.
#   sudo bash scripts/do-restore-website-service.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
P=$(systemctl show -p MainPID --value bilara)
[ -n "$P" ] && [ "$P" != 0 ] || { echo "Service 'bilara' is not running — cannot read it. Stop and tell Claude."; exit 1; }
if grep -q "Bilara test app" /proc/$P/environ 2>/dev/null || [ "$(readlink /proc/$P/cwd)" = /root/bilara-ops ]; then echo "The running 'bilara' is the test app, not the website. Stop and tell Claude."; exit 1; fi
EXE=$(readlink /proc/$P/exe); CWD=$(readlink /proc/$P/cwd); USR=$(ps -o user= -p $P | tr -d ' ')
[ -f "$CWD/server.js" ] || { echo "No server.js in $CWD. Stop and tell Claude."; exit 1; }
cp -n /etc/systemd/system/bilara.service /root/bilara.service.overwritten 2>/dev/null || true
tr '\0' '\n' < /proc/$P/environ | grep -vE '^(INVOCATION_ID|JOURNAL_STREAM|SYSTEMD_EXEC_PID|MANAGERPID|NOTIFY_SOCKET|LISTEN_[A-Z]+|_)=' > /etc/bilara-website.env
chmod 600 /etc/bilara-website.env
cat > /etc/systemd/system/bilara.service <<UNIT
[Unit]
Description=Bilara website
After=network-online.target
Wants=network-online.target

[Service]
User=$USR
WorkingDirectory=$CWD
EnvironmentFile=/etc/bilara-website.env
ExecStart=$EXE server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable bilara >/dev/null
echo "Checking a copy of the website starts (port 3999)…"
systemd-run --unit=bilara-check --uid="$USR" -p WorkingDirectory="$CWD" -p EnvironmentFile=/etc/bilara-website.env /usr/bin/env PORT=3999 HOSTNAME=127.0.0.1 "$EXE" server.js >/dev/null
ok=0; for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3999/ || true); [ "$c" = 200 ] && { ok=1; break; }; sleep 1; done
systemctl stop bilara-check 2>/dev/null || true
echo "Website service file restored: $EXE server.js in $CWD as $USR"
[ $ok = 1 ] && echo "CHECK OK — the website will come back after a restart or reboot." || echo "CHECK FAILED (got $c) — do not reboot; send this output to Claude."
