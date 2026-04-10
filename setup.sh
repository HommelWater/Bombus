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

# Extract only the HTTP (port 80) server block from the full template
create_http_config() {
    local template="$1" output="$2"
    local temp_full="/tmp/${SERVICE_NAME}.full.conf"
    envsubst '$SERVICE_NAME $DOMAIN $PORT $USER $PWD' < "$template" > "$temp_full"
    
    awk '
        /^server \{/ { in_server=1; is_https=0; block="" }
        in_server {
            block = block $0 "\n"
            if ($0 ~ /listen .*443/) is_https=1
            if ($0 == "}") {
                if (!is_https) print block
                in_server=0
            }
            next
        }
        { print }
    ' "$temp_full" > "$output"
}

update_packages() {
    log "Updating system packages"
    sudo apt-get update -qq
    sudo apt-get install -y python3 python3-venv nginx certbot perl
    git pull || warn "Could not pull – working with existing code"
}

request_info(){
    read -rp "App Name: " APP_NAME
    read -rp "Service Name: " SERVICE_NAME
    read -rp "Domain (e.g. example.com): " DOMAIN
    read -rp "Port: " PORT
    read -rp "Gemini API key: " GEMINI_API_KEY
}

setup_python_env(){
    VENV_DIR="$(pwd)/venv"
    if [[ ! -d "$VENV_DIR" ]]; then
        log "Creating Python virtualenv"
        python3 -m venv "$VENV_DIR"
    fi
    source "$VENV_DIR/bin/activate"
    pip install -q -U pip setuptools wheel
    pip install -q fastapi uvicorn websockets pyotp pillow aiosqlite python-dotenv pywebpush aiofiles google-genai tantivy
}

# Create only the HTTP nginx config (no SSL references)
create_http_site_config(){
    local http_config="/tmp/${SERVICE_NAME}.http.conf"
    create_http_config "templates/nginx.template" "$http_config"
    sudo cp "$http_config" "/etc/nginx/sites-available/${SERVICE_NAME}"
    SITE_FILE="/etc/nginx/sites-available/${SERVICE_NAME}"
    log "Created HTTP-only nginx config"
}

# Replace with full SSL config after certificate exists
install_full_nginx_config() {
    render_template "templates/nginx.template" "/tmp/${SERVICE_NAME}.full.conf"
    sudo cp "/tmp/${SERVICE_NAME}.full.conf" "/etc/nginx/sites-available/${SERVICE_NAME}"
    log "Replaced with full SSL config"
}

create_dotenv(){
    cat > .env <<EOF
APP_NAME='${APP_NAME}'
SERVICE_NAME='${SERVICE_NAME}'
DOMAIN='${DOMAIN}'
PORT='${PORT}'
GEMINI_API_KEY='${GEMINI_API_KEY}'
EOF
}

setup_certificate() {
    log "Obtaining SSL certificate for $DOMAIN using webroot (zero downtime)"
    sudo mkdir -p /var/www/certbot
    sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" \
        --non-interactive --agree-tos -m "admin@${DOMAIN}" || die "Certbot failed"
}

# ------------------------------------------------------------------
# Main execution
update_packages
setup_python_env
request_info
create_dotenv

# 1. Create systemd service (app not started yet)
render_template templates/service.template "/tmp/${SERVICE_NAME}.service"
sudo mv "/tmp/${SERVICE_NAME}.service" /etc/systemd/system/
sudo systemctl daemon-reload

# 2. Set up HTTP-only nginx site (no SSL, serves webroot for certbot)
create_http_site_config
sudo ln -sf "$SITE_FILE" /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx || die "Nginx HTTP config invalid"

# 3. Obtain SSL certificate via webroot (Nginx already serves .well-known)
setup_certificate

# 4. Replace with full SSL nginx config (certificate now exists)
install_full_nginx_config
sudo nginx -t && sudo systemctl reload nginx || die "Nginx SSL config invalid"

# 5. Start the application service
sudo systemctl enable --now "${SERVICE_NAME}"

log "Done – your app is live at https://${DOMAIN}/"
sudo journalctl -u "${SERVICE_NAME}" -f