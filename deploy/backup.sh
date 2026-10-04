#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/summit-base}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/summit-base}"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"

mkdir -p "$BACKUP_DIR"

# SQLite backup melalui VACUUM INTO agar backup konsisten.
DB="$APP_DIR/data/summit-base.sqlite"
OUT="$BACKUP_DIR/summit-base-$STAMP.sqlite"

if [ ! -f "$DB" ]; then
  echo "Database belum ada: $DB"
  exit 0
fi

node - "$DB" "$OUT" <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const [dbFile, outFile] = process.argv.slice(2);
const db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${outFile.replaceAll("'", "''")}'`);
db.close();
console.log(`Backup: ${outFile}`);
NODE

find "$BACKUP_DIR" -type f -name 'summit-base-*.sqlite' -mtime +14 -delete
