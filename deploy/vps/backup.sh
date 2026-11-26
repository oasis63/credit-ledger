#!/bin/sh
# Daily database backup. Add to crontab:  0 2 * * * /path/to/deploy/vps/backup.sh
# Keeps 14 days of compressed dumps in ./backups. Copy them off the server too (rclone, restic, S3...).
# Restore: gunzip -c backups/ledger-XXXX.sql.gz | docker compose exec -T db psql -U ledger -d ledger
set -eu
cd "$(dirname "$0")"
mkdir -p backups
docker compose exec -T db pg_dump -U ledger -d ledger --no-owner | gzip > "backups/ledger-$(date +%Y%m%d-%H%M).sql.gz"
find backups -name 'ledger-*.sql.gz' -mtime +14 -delete
