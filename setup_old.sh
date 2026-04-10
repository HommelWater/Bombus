#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# --- Colours --------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()  { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ------------------------------------------------------------------
log "Updating system packages"
sudo apt-get update -qq
sudo apt-get install -y python3 python3-venv nginx certbot python3-certbot-nginx perl

# ------------------------------------------------------------------
log "Pulling latest code"
git pull || warn "Could not pull – working with existing code"

# Collect user input only once
# ------------------------------------------------------------------
read -rp "Service Name: "  SERVICE_NAME
read -rp "Domain (e.g. example.com): " DOMAIN
read -rp "Port: " PORT

# Python virtual environment
# ------------------------------------------------------------------
VENV_DIR="$(pwd)/venv"

if [[ ! -d "$VENV_DIR" ]]; then
    log "Creating Python virtualenv"
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
pip install -q -U pip setuptools wheel
pip install -q fastapi uvicorn websockets pyotp pillow aiosqlite python-dotenv pywebpush aiofiles google-genai tantivy

# Environment file
# ------------------------------------------------------------------
cat > .env <<EOF
SERVICE_NAME='${SERVICE_NAME}'
DOMAIN='${DOMAIN}'
EOF

# systemd service (idempotent)
# ------------------------------------------------------------------
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Bombuss Chat Server
After=network.target

[Service]
User=$(whoami)
WorkingDirectory=$(pwd)
EnvironmentFile=$(pwd)/.env
ExecStart=$(pwd)/venv/bin/uvicorn -u server:app --host 127.0.0.1 --port ${PORT} --workers 1
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ${SERVICE_NAME}

# Nginx site
# ------------------------------------------------------------------
SITE_FILE="/etc/nginx/sites-available/${SERVICE_NAME}"

sudo tee "$SITE_FILE" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # Certbot webroot (must be public for verification)
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    location ~* \.(php|phtml|pl|py|cgi)$ {
        return 444;
    }

    # WebSocket location
    location /ws {
        proxy_pass http://127.0.0.1:${PORT}/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    # Normal HTTP traffic
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        include /etc/nginx/proxy_params;
    }
}
EOF

sudo ln -sf "$SITE_FILE" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Certificate (only if none exists)
# ------------------------------------------------------------------
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
if [[ ! -f "$CERT_PATH" ]]; then
    log "Obtaining SSL certificate"
    sudo mkdir -p /var/www/certbot
    sudo chown www-data:www-data /var/www/certbot
    sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
         --non-interactive --agree-tos -m "admin@${DOMAIN}" || \
         die "Certbot failed"
fi

# Upgrade to HTTPS (if not already done)
# ------------------------------------------------------------------
if ! grep -q "listen 443 ssl" "$SITE_FILE"; then
    log "Enabling HTTPS redirect"
    sudo certbot --nginx -d "$DOMAIN" --non-interactive --redirect
fi

sudo nginx -t && sudo systemctl reload nginx || die "Nginx config invalid"

# ------------------------------------------------------------------
log "Done – your app is live at https://${DOMAIN}/"
# ------------------------------------------------------------------
sudo journalctl -u ${SERVICE_NAME} -f