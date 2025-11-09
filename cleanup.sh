#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# --- Colours --------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()  { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# --- Load Configuration (with fallback prompts) ---------------------
if [[ -f ".env" ]]; then
    source .env
    log "Loaded .env file"
else
    warn ".env not found, will prompt for values"
fi

# Prompt for any missing values
[[ -z "${SERVICE_NAME:-}" ]] && read -rp "Service Name: " SERVICE_NAME
[[ -z "${DOMAIN:-}" ]]       && read -rp "Domain: " DOMAIN
[[ -z "${PORT:-}" ]]         && read -rp "Port: " PORT

: "${SERVICE_NAME:?SERVICE_NAME is required}"
: "${DOMAIN:?DOMAIN is required}"
: "${PORT:?PORT is required}"

# --- 1. Stop & Kill Services ----------------------------------------
log "Terminating service and freeing port..."
sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
sudo systemctl daemon-reload

# Force kill any processes holding the port
sudo fuser -k "${PORT}/tcp" 2>/dev/null || true
sudo pkill -9 -f "uvicorn.*${SERVICE_NAME}" 2>/dev/null || true

# Remove systemd service
sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"

# --- 2. Nginx Deep Cleanup ------------------------------------------
log "Resetting Nginx configuration..."
sudo systemctl stop nginx 2>/dev/null || true

# Remove site configs
sudo rm -f "/etc/nginx/sites-available/${SERVICE_NAME}"
sudo rm -f "/etc/nginx/sites-enabled/${SERVICE_NAME}"

# Remove certbot-generated snippets (crucial for your bug!)
sudo rm -f "/etc/nginx/snippets/certbot-${DOMAIN}.conf" 2>/dev/null || true

# Restore default site if needed
if [[ -f "/etc/nginx/sites-available/default" ]]; then
    sudo ln -sf "/etc/nginx/sites-available/default" "/etc/nginx/sites-enabled/default"
fi

# --- 3. SSL Certificate Removal ------------------------------------
log "Purging SSL certificates..."
if certbot certificates 2>/dev/null | grep -q "Domains: ${DOMAIN}"; then
    sudo certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null || \
        warn "Certbot delete failed"
fi

# Manual cleanup as fallback
sudo rm -rf "/etc/letsencrypt/live/${DOMAIN}"
sudo rm -rf "/etc/letsencrypt/archive/${DOMAIN}"
sudo rm -f "/etc/letsencrypt/renewal/${DOMAIN}.conf"
sudo rm -rf /var/www/certbot

# --- 4. Application Cleanup -----------------------------------------
log "Removing application files..."
rm -rf "./venv"
rm -f ".env"

# --- 5. Final System Reset -----------------------------------------
log "Starting Nginx with clean slate..."
sudo nginx -t && sudo systemctl start nginx 2>/dev/null || \
    die "Nginx is broken - check config manually"

log "✅ Cleanup complete! All traces removed."

# --- Reminder -------------------------------------------------------
echo -e "\n${YELLOW}Next steps:${NC}"
echo "1. Run: sudo systemctl reset-failed ${SERVICE_NAME}"
echo "2. Run your install script again"