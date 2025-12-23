#!/usr/bin/env bash
# quick-stun.sh – interactive CoTURN installer + env-file writer
# -------------------------------------------------------------------
set -euo pipefail

# colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[1;34m'; NC='\033[0m'

ask(){
  local prompt=$1 default=$2
  read -rp "${BLUE}${prompt}${NC} (${default}): " val
  echo "${val:-$default}"
}

banner(){
  echo -e "${GREEN}=== CoTURN interactive installer ===${NC}"
}

get_input(){
  DOMAIN=$(ask "Domain name (empty for bare-IP)" "")
  PUBLIC_IP=$(ask "Public IPv4" "$(curl -4 -s https://ifconfig.me)")
  SECRET=$(ask "Static auth secret (leave empty for random)" "")
  [[ -z "$SECRET" ]] && SECRET=$(openssl rand -hex 32)
}

warn_ports(){
  echo -e "${RED}IMPORTANT – open these ports in your cloud panel + local firewall:${NC}"
  cat <<EOF
  3478  UDP+TCP  (STUN/TURN)
  5349  UDP+TCP  (TURNS – TLS)
  49152-65535  UDP  (relay)
EOF
}

install_deps(){
  echo -e "${GREEN}* Installing packages…${NC}"
  sudo apt-get update -qq
  sudo apt-get install -y coturn certbot
}

write_conf(){
  echo -e "${GREEN}* Writing /etc/turnserver.conf…${NC}"
  sudo tee /etc/turnserver.conf > /dev/null <<EOF
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=${PUBLIC_IP}
external-ip=${PUBLIC_IP}
realm=${DOMAIN:-${PUBLIC_IP}}
server-name=${DOMAIN:-${PUBLIC_IP}}
use-auth-secret
static-auth-secret=${SECRET}
fingerprint
no-multicast-peers
no-cli
syslog
EOF

  if [[ -n "$DOMAIN" ]]; then
    echo -e "${GREEN}* Obtaining Let’s-Encrypt cert…${NC}"
    sudo systemctl stop coturn || true
    sudo certbot certonly --standalone -d "$DOMAIN" --agree-tos --email admin@"$DOMAIN" -n
    sudo tee -a /etc/turnserver.conf > /dev/null <<EOF
cert=/etc/letsencrypt/live/${DOMAIN}/fullchain.pem
pkey=/etc/letsencrypt/live/${DOMAIN}/privkey.pem
EOF
    sudo systemctl start coturn
  fi
}

enable_service(){
  echo -e "${GREEN}* Enabling CoTURN service…${NC}"
  sudo sed -i 's/^TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  sudo systemctl enable coturn --now
}

write_env(){
  ENV_FILE=.env
  echo -e "${GREEN}* Writing FastAPI env file → ${YELLOW}${ENV_FILE}${NC}"
  cat >> "$ENV_FILE" <<EOF
# source this file or export before starting FastAPI
TURN_SECRET=${SECRET}
TURN_HOST=${DOMAIN:-${PUBLIC_IP}}
EOF
  chmod 600 "$ENV_FILE"
}

show_creds(){
  echo -e "${GREEN}* Server ready – sample credentials (valid 24 h)${NC}"
  cat <<EOF
  TURN uri : turn:${DOMAIN:-${PUBLIC_IP}}:3478
  username : \$(date +%s):demo
  password : \$(echo -n "\$(date +%s):demo" | openssl sha1 -hmac "${SECRET}" -binary | base64)
EOF
}

# ------------------------------------------------------------------
banner
get_input
warn_ports
read -p "Press Enter when ports are open ..."
install_deps
write_conf
enable_service
write_env
show_creds
echo -e "${GREEN}Done!${NC}"
