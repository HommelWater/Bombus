#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
PRIVATE_PEM="vapid_private.pem"
PUBLIC_PEM="vapid_public.pem"

echo "🔐 Generating VAPID key pair..."

# Generate the EC private key
openssl ecparam -name prime256v1 -genkey -noout -out "$PRIVATE_PEM"
echo "✅ Private key saved to $PRIVATE_PEM"

# Extract the public key
openssl ec -in "$PRIVATE_PEM" -pubout -out "$PUBLIC_PEM"
echo "✅ Public key saved to $PUBLIC_PEM"

# Convert PEM -> base64 (single line)
PRIVATE_KEY_B64=$(sed -ne '/^-----BEGIN/,/^-----END/ p' "$PRIVATE_PEM" | sed '1d;$d' | tr -d '\n')
PUBLIC_KEY_B64=$(sed -ne '/^-----BEGIN/,/^-----END/ p' "$PUBLIC_PEM" | sed '1d;$d' | tr -d '\n')

# Ask user for sub email (for VAPID claims)
read -rp "📧 Enter a contact email for VAPID (e.g. admin@example.com): " USER_EMAIL

# Basic email validation
if [[ ! "$USER_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "❌ Invalid email format. Please rerun and enter a valid email address."
  exit 1
fi

# Ensure .env exists
if [ ! -f "$ENV_FILE" ]; then
  touch "$ENV_FILE"
  echo "# VAPID keys generated on $(date)" >> "$ENV_FILE"
fi

# Remove any existing entries to avoid duplicates
grep -v '^VAPID_PRIVATE_KEY=' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
grep -v '^VAPID_PUBLIC_KEY=' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
grep -v '^VAPID_SUB=' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"

# Append keys + sub email
{
  echo "VAPID_PRIVATE_KEY=$PRIVATE_KEY_B64"
  echo "VAPID_PUBLIC_KEY=$PUBLIC_KEY_B64"
  echo "VAPID_SUB=mailto:$USER_EMAIL"
} >> "$ENV_FILE"

# Remove generated PEM files for security
rm -f "$PRIVATE_PEM" "$PUBLIC_PEM"

echo "✅ Done. Keys and contact info saved to $ENV_FILE."
echo "⚠️ Keep your .env secure! The private key must remain secret."
