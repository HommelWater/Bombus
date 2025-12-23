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

render_template() {
    local template="$1" output="$2"
    envsubst '$SERVICE_NAME $DOMAIN $PORT $USER $PWD' < "$template" > "$output"
    log "Created $output"
}

update_packages() {
    log "Updating system packages"
    sudo apt-get update -qq
    sudo apt-get install -y python3 python3-venv nginx certbot python3-certbot-nginx perl
    git pull || warn "Could not pull – working with existing code"
}

request_info(){
    read -rp "App Name: " APP_NAME
    read -rp "Service Name: " SERVICE_NAME
    read -rp "Domain (e.g. example.com): " DOMAIN
    read -rp "Port: " PORT
}

setup_python_env(){
    VENV_DIR="$(pwd)/venv"
    if [[ ! -d "$VENV_DIR" ]]; then
        log "Creating Python virtualenv"
        python3 -m venv "$VENV_DIR"
    fi
    source "$VENV_DIR/bin/activate"
    pip install -q -U pip setuptools wheel
    pip install -q fastapi uvicorn websockets pyotp pillow aiosqlite python-dotenv pywebpush aiofiles
}

create_config_files(){
    render_template templates/service.template "/tmp/${SERVICE_NAME}.service"
    sudo mv "/tmp/${SERVICE_NAME}.service" /etc/systemd/system/
    render_template templates/nginx.template "/tmp/${SERVICE_NAME}.conf"
    sudo mv "/tmp/${SERVICE_NAME}.conf" /etc/nginx/sites-available/
}

create_dotenv(){
    cat > .env <<EOF
APP_NAME='${APP_NAME}'
SERVICE_NAME='${SERVICE_NAME}'
DOMAIN='${DOMAIN}'
EOF
}

setup_certificate(){
    CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
    if [[ ! -f "$CERT_PATH" ]]; then
        log "Obtaining SSL certificate"
        sudo mkdir -p /var/www/certbot
        sudo chown www-data:www-data /var/www/certbot
        sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
            --non-interactive --agree-tos -m "admin@${DOMAIN}" || \
            die "Certbot failed"
    fi
    if ! grep -q "listen 443 ssl" "$SITE_FILE"; then
        log "Enabling HTTPS redirect"
        sudo certbot --nginx -d "$DOMAIN" --non-interactive --redirect
    fi
}

update_packages
setup_python_env
request_info
create_dotenv
create_config_files
sudo systemctl daemon-reload
sudo systemctl enable --now ${SERVICE_NAME}
sudo ln -sf "$SITE_FILE" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
setup_certificate
sudo nginx -t && sudo systemctl reload nginx || die "Nginx config invalid"
log "Done – your app is live at https://${DOMAIN}/"
sudo journalctl -u ${SERVICE_NAME} -f