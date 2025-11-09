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
if [[ ! -f ".env" ]]; then
    die ".env file not found. Cannot determine SERVICE_NAME and DOMAIN."
fi

# Load environment variables
source ./.env

# Check required variables
: "${SERVICE_NAME:?SERVICE_NAME is not set in .env}"
: "${DOMAIN:?DOMAIN is not set in .env}"

# ------------------------------------------------------------------
log "Stopping and disabling systemd service"
if systemctl list-units --full -all | grep -q "${SERVICE_NAME}.service"; then
    sudo systemctl stop "${SERVICE_NAME}"
    sudo systemctl disable "${SERVICE_NAME}"
    sudo rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    sudo systemctl daemon-reload
    log "Systemd service removed"
else
    warn "Systemd service not found"
fi

# ------------------------------------------------------------------
log "Removing Nginx site configuration"
SITE_FILE="/etc/nginx/sites-available/${SERVICE_NAME}"
if [[ -f "$SITE_FILE" ]]; then
    sudo rm -f "$SITE_FILE"
    sudo rm -f "/etc/nginx/sites-enabled/${SERVICE_NAME}"
    sudo nginx -t && sudo systemctl reload nginx || warn "Nginx reload failed"
    log "Nginx site removed"
else
    warn "Nginx site file not found"
fi

# ------------------------------------------------------------------
log "Removing SSL certificates (Let's Encrypt)"
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"
if [[ -d "$CERT_PATH" ]]; then
    sudo certbot delete --cert-name "$DOMAIN" --non-interactive || warn "Failed to remove cert via certbot"
    log "SSL certificate removed"
else
    warn "No certificate found for $DOMAIN"
fi

# ------------------------------------------------------------------
log "Removing Python virtual environment"
VENV_DIR="$(pwd)/venv"
if [[ -d "$VENV_DIR" ]]; then
    rm -rf "$VENV_DIR"
    log "Virtual environment removed"
else
    warn "No virtual environment found"
fi

# ------------------------------------------------------------------
log "Removing environment file"
rm -f .env
log ".env file removed"

# ------------------------------------------------------------------
log "Cleanup complete ✅"