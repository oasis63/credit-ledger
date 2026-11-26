#!/bin/sh
# Creates .env with random secrets. Safe to run again: it never overwrites an existing .env.
set -eu
cd "$(dirname "$0")"
if [ -f .env ]; then echo ".env already exists - edit it directly."; exit 0; fi
printf "Your domain (e.g. ledger.example.in): "; read -r domain
printf "Your GitHub user or org (for ghcr.io images, blank to build on this server): "; read -r gh
cp .env.example .env
rnd() { openssl rand -hex "$1"; }
sed -i.bak \
  -e "s|^DOMAIN=.*|DOMAIN=$domain|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rnd 16)|" \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$(rnd 32)|" \
  -e "s|^STATEMENT_LINK_SECRET=.*|STATEMENT_LINK_SECRET=$(rnd 32)|" .env
if [ -n "$gh" ]; then sed -i.bak "s|your-github-user|$gh|g" .env; fi
rm -f .env.bak
chmod 600 .env
echo "Created .env. Next: docker compose up -d$( [ -z "$gh" ] && echo ' --build')"
