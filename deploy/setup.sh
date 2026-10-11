#!/usr/bin/env bash
# Installs or updates the Karting server on an Ubuntu/Debian droplet. Safe to run again and again.
#
#   bash deploy/setup.sh [domain]
#
# Run from an unpacked copy of the repo (the GitHub Actions deploy does this for you).
#  - installs Node 22 if Node 20+ is missing
#  - copies the game to /opt/karting and runs it as the systemd service "karting"
#  - with a domain: puts it behind HTTPS using the web server that is already there
#    (Caddy or nginx), or installs Caddy if port 80 is free. Existing sites are left alone:
#    every config change is validated first and rolled back if it fails.
#  - without a domain: serves the game straight on port 3000 (http://<droplet-ip>:3000)

set -euo pipefail

DOMAIN="${1:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/karting
PORT=3000
SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

say() { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!  %s\n' "$*"; }

if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "That domain does not look right: $DOMAIN" >&2
  exit 1
fi

# ------------------------------------------------------------------ Node
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  say "Installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | ${SUDO:+$SUDO -E} bash -
  $SUDO apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
say "Node $(node -v) at $NODE_BIN"

# ------------------------------------------------------------------ code
say "Copying the game to $APP"
$SUDO mkdir -p "$APP"
if command -v rsync >/dev/null 2>&1; then
  $SUDO rsync -a --delete --exclude .git --exclude node_modules --exclude dist-share "$SRC/" "$APP/"
else
  $SUDO find "$APP" -mindepth 1 -delete
  $SUDO cp -a "$SRC/." "$APP/"
  $SUDO rm -rf "$APP/.git"
fi
$SUDO chmod -R a+rX "$APP"

# ------------------------------------------------------------------ service
HOST_BIND=127.0.0.1
[ -z "$DOMAIN" ] && HOST_BIND=0.0.0.0
say "Installing the karting service (listening on $HOST_BIND:$PORT)"
sed -e "s#^ExecStart=.*#ExecStart=$NODE_BIN server/index.js#" \
    -e "s#^Environment=HOST=.*#Environment=HOST=$HOST_BIND#" \
    -e "s#^Environment=PORT=.*#Environment=PORT=$PORT#" \
    "$APP/deploy/karting.service" | $SUDO tee /etc/systemd/system/karting.service >/dev/null
$SUDO systemctl daemon-reload
$SUDO systemctl enable karting >/dev/null 2>&1
$SUDO systemctl restart karting

for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -fsS "http://127.0.0.1:$PORT/health"; then
  warn "The game server did not start. Last log lines:"
  $SUDO journalctl -u karting -n 30 --no-pager || true
  exit 1
fi
echo

open_port() {
  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    $SUDO ufw allow "$1" >/dev/null
  fi
}

if [ -z "$DOMAIN" ]; then
  open_port "$PORT/tcp"
  say "Done. Play at http://<this-droplet's-ip>:$PORT"
  exit 0
fi

# ------------------------------------------------------------------ HTTPS front
who_has_80="$($SUDO ss -ltnpH 'sport = :80' 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | sed 's/users:(("//' || true)"
say "Port 80 is used by: ${who_has_80:-nothing}"

caddy_site() {
  local file=/etc/caddy/Caddyfile
  local begin="# karting: begin" end="# karting: end"
  $SUDO touch "$file"
  $SUDO cp "$file" "$file.karting-backup"
  # replace our block if it is already there, otherwise append it
  $SUDO sed -i "/$begin/,/$end/d" "$file"
  # drop trailing blank lines so repeated deploys do not pile them up
  awk 'NF { for (; n > 0; n--) print ""; print; next } { n++ }' "$file" | $SUDO tee "$file.karting-tmp" >/dev/null
  $SUDO mv "$file.karting-tmp" "$file"
  printf '\n%s\n%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:%s\n}\n%s\n' "$begin" "$DOMAIN" "$PORT" "$end" | $SUDO tee -a "$file" >/dev/null
  if $SUDO caddy validate --config "$file" --adapter caddyfile >/dev/null 2>&1; then
    $SUDO systemctl reload caddy || $SUDO systemctl restart caddy
  else
    warn "Caddy rejected the new config; putting the old one back."
    $SUDO cp "$file.karting-backup" "$file"
    exit 1
  fi
}

nginx_site() {
  local avail=/etc/nginx/sites-available/karting
  local enabled=/etc/nginx/sites-enabled/karting
  if [ ! -d /etc/nginx/sites-available ]; then
    avail=/etc/nginx/conf.d/karting.conf
    enabled=""
  fi
  local had_cert=0
  [ -f "$avail" ] && grep -q ssl_certificate "$avail" && had_cert=1
  if [ "$had_cert" -eq 0 ]; then
    $SUDO tee "$avail" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
EOF
    [ -n "$enabled" ] && $SUDO ln -sf "$avail" "$enabled"
  fi
  if $SUDO nginx -t >/dev/null 2>&1; then
    $SUDO systemctl reload nginx
  else
    warn "nginx rejected the new site; removing it."
    $SUDO rm -f "$avail" ${enabled:+"$enabled"}
    $SUDO nginx -t && $SUDO systemctl reload nginx
    exit 1
  fi
  if [ "$had_cert" -eq 0 ]; then
    if ! command -v certbot >/dev/null 2>&1; then
      say "Installing certbot"
      $SUDO apt-get install -y certbot python3-certbot-nginx >/dev/null
    fi
    say "Getting an HTTPS certificate for $DOMAIN"
    if ! $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
      warn "No certificate yet (is the DNS record for $DOMAIN pointing here?). The game works on http://$DOMAIN for now; the next deploy tries again."
    fi
  fi
}

install_caddy() {
  say "Installing Caddy"
  $SUDO apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  $SUDO apt-get update >/dev/null
  $SUDO apt-get install -y caddy >/dev/null
  # start from an empty Caddyfile rather than the welcome-page default
  echo "" | $SUDO tee /etc/caddy/Caddyfile >/dev/null
}

case "$who_has_80" in
  caddy) caddy_site ;;
  nginx) nginx_site ;;
  "")
    if command -v nginx >/dev/null 2>&1; then
      warn "nginx is installed but not running; leaving it alone and using Caddy."
    fi
    command -v caddy >/dev/null 2>&1 || install_caddy
    $SUDO systemctl enable --now caddy >/dev/null 2>&1 || true
    caddy_site
    ;;
  *)
    warn "Port 80 belongs to '$who_has_80', which this script does not know how to configure."
    warn "The game is running on 127.0.0.1:$PORT. Point that program at it (see deploy/README.md), or re-run without a domain to serve it on port $PORT."
    exit 1
    ;;
esac
open_port 80/tcp
open_port 443/tcp

say "Done. Play at https://$DOMAIN"
