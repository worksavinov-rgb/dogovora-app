#!/usr/bin/env bash
# Полный бэкап Догодок (dogovora-app) → Synology WebDAV.
#
# В архиве: pg_dump (docker db), .env.production, storage/, logs/, nginx.conf, MANIFEST.
# Конфиг: /app/.backup-webdav.env
# Расписание: crontab, см. install-backup.sh.
set -euo pipefail

APP_DIR="${DOGODOC_APP_DIR:-/app}"
ENV_FILE="${DOGODOC_BACKUP_ENV:-$APP_DIR/.backup-webdav.env}"
WORK="${DOGODOC_BACKUP_WORK:-$APP_DIR/var/backup-webdav-work}"
KEEP_LOCAL_DAYS="${DOGODOC_BACKUP_KEEP_LOCAL_DAYS:-1}"
APP_ENV="$APP_DIR/.env.production"
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${WEBDAV_URL:?WEBDAV_URL не задан в $ENV_FILE}"
: "${WEBDAV_USER:?WEBDAV_USER не задан в $ENV_FILE}"
: "${WEBDAV_PASSWORD:?WEBDAV_PASSWORD не задан в $ENV_FILE}"
: "${ARCHIVE_PASSWORD:?ARCHIVE_PASSWORD не задан в $ENV_FILE}"

if [[ -z "${WEBDAV_PASSWORD// }" || "$WEBDAV_PASSWORD" == "…" || "$WEBDAV_PASSWORD" == "..." ]]; then
  echo "WEBDAV_PASSWORD пустой — вставьте пароль в $ENV_FILE" >&2
  exit 1
fi
if [[ -z "${ARCHIVE_PASSWORD// }" || "$ARCHIVE_PASSWORD" == "…" || "$ARCHIVE_PASSWORD" == "..." ]]; then
  echo "ARCHIVE_PASSWORD пустой — задайте пароль шифрования архива в $ENV_FILE" >&2
  exit 1
fi

[[ -d "$APP_DIR" ]] || { echo "нет APP_DIR: $APP_DIR" >&2; exit 1; }
[[ -f "$APP_ENV" ]] || { echo "нет $APP_ENV" >&2; exit 1; }
[[ -f "$COMPOSE_FILE" ]] || { echo "нет $COMPOSE_FILE" >&2; exit 1; }

command -v curl >/dev/null || { echo "нужен curl"; exit 1; }
command -v tar >/dev/null || { echo "нужен tar"; exit 1; }
command -v gzip >/dev/null || { echo "нужен gzip"; exit 1; }
command -v openssl >/dev/null || { echo "нужен openssl"; exit 1; }
command -v docker >/dev/null || { echo "нужен docker"; exit 1; }

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$APP_ENV")
elif command -v docker-compose >/dev/null; then
  COMPOSE=(docker-compose -f "$COMPOSE_FILE" --env-file "$APP_ENV")
else
  echo "нужен docker compose" >&2
  exit 1
fi

env_get() {
  local key="$1" default="${2:-}"
  local line
  line="$(grep -E "^${key}=" "$APP_ENV" | head -1 || true)"
  if [[ -z "$line" ]]; then
    printf '%s' "$default"
    return
  fi
  printf '%s' "${line#*=}" | sed 's/^["'\'']//;s/["'\'']$//'
}

POSTGRES_USER="$(env_get POSTGRES_USER dogovora)"
POSTGRES_DB="$(env_get POSTGRES_DB dogovora)"
# Из DATABASE_URL часто только пароль в POSTGRES_PASSWORD; user/db — из compose defaults.
STORAGE_DIR_RAW="$(env_get STORAGE_DIR storage)"
if [[ "$STORAGE_DIR_RAW" = /* ]]; then
  STORAGE_HOST="$STORAGE_DIR_RAW"
else
  STORAGE_HOST="$APP_DIR/$STORAGE_DIR_RAW"
fi

STAMP=$(date +%Y-%m-%d_%H%M%S)
STAGE="$WORK/stage-$STAMP"
ARCHIVE="$WORK/dogodoc-${STAMP}.tar.gz"
ENCRYPTED="$ARCHIVE.enc"
REMOTE_NAME="dogodoc-${STAMP}.tar.gz.enc"
WEBDAV_BASE="${WEBDAV_URL%/}"
CURL_OUT="$WORK/webdav-last.out"

cleanup() {
  rm -rf "$STAGE"
  rm -f "$ARCHIVE" "$ENCRYPTED"
}
trap cleanup EXIT

mkdir -p "$WORK" "$STAGE"/{db,env,storage,logs,nginx}

echo "==> pg_dump (docker db)"
(
  cd "$APP_DIR"
  "${COMPOSE[@]}" exec -T db \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges
) | gzip -9 > "$STAGE/db/dogodoc.sql.gz"
ls -lh "$STAGE/db/dogodoc.sql.gz"

echo "==> .env.production"
install -m 600 "$APP_ENV" "$STAGE/env/.env.production"

echo "==> storage ($STORAGE_HOST)"
if [[ -d "$STORAGE_HOST" ]] && ls -A "$STORAGE_HOST" >/dev/null 2>&1; then
  if command -v rsync >/dev/null; then
    rsync -a "$STORAGE_HOST/" "$STAGE/storage/"
  else
    cp -a "$STORAGE_HOST/." "$STAGE/storage/"
  fi
elif (
  cd "$APP_DIR"
  "${COMPOSE[@]}" exec -T web sh -c 'd="${STORAGE_DIR:-storage}"; test -d "$d" && ls -A "$d" 2>/dev/null | grep -q .'
); then
  (
    cd "$APP_DIR"
    "${COMPOSE[@]}" exec -T web sh -c 'd="${STORAGE_DIR:-storage}"; tar -C "$d" -cf - .'
  ) | tar -C "$STAGE/storage" -xf -
else
  echo "  (storage пуст или недоступен — ок)"
fi

echo "==> logs"
if [[ -d "$APP_DIR/logs" ]]; then
  if command -v rsync >/dev/null; then
    rsync -a "$APP_DIR/logs/" "$STAGE/logs/" || true
  else
    cp -a "$APP_DIR/logs/." "$STAGE/logs/" || true
  fi
fi

echo "==> nginx.conf"
if [[ -f "$APP_DIR/nginx.conf" ]]; then
  cp -a "$APP_DIR/nginx.conf" "$STAGE/nginx/nginx.conf"
fi

{
  echo "host=$(hostname -f 2>/dev/null || hostname)"
  echo "created_at=$(date -Iseconds)"
  echo "app_dir=$APP_DIR"
  echo "run_as=$(id -un)"
  echo "dogodoc_git=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "dogodoc_git_subject=$(git -C "$APP_DIR" log -1 --format=%s 2>/dev/null || echo unknown)"
  echo "storage_host=$STORAGE_HOST"
  echo "note=код из GitHub; образы ghcr.io; compose docker-compose.prod.yml"
  echo "restore_db=gunzip -c db/dogodoc.sql.gz | docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db psql -U dogovora -d dogovora"
} > "$STAGE/MANIFEST.txt"

echo "==> tar.gz"
tar -C "$STAGE" -czf "$ARCHIVE" MANIFEST.txt db env storage logs nginx
ls -lh "$ARCHIVE"

echo "==> шифрование AES-256 (openssl, pbkdf2)"
openssl enc -aes-256-cbc -pbkdf2 -salt \
  -in "$ARCHIVE" -out "$ENCRYPTED" \
  -pass env:ARCHIVE_PASSWORD
rm -f "$ARCHIVE"
ls -lh "$ENCRYPTED"

echo "==> WebDAV PUT $WEBDAV_BASE/$REMOTE_NAME"
curl -sS -o /dev/null -w '' \
  -u "$WEBDAV_USER:$WEBDAV_PASSWORD" \
  -X MKCOL "$WEBDAV_BASE/" || true

HTTP=$(curl -sS -o "$CURL_OUT" -w '%{http_code}' \
  -u "$WEBDAV_USER:$WEBDAV_PASSWORD" \
  -H 'Content-Type: application/octet-stream' \
  -T "$ENCRYPTED" \
  "$WEBDAV_BASE/$REMOTE_NAME" || true)

if [[ "$HTTP" != "201" && "$HTTP" != "204" && "$HTTP" != "200" ]]; then
  echo "WebDAV upload failed HTTP $HTTP" >&2
  head -c 500 "$CURL_OUT" >&2 || true
  echo >&2
  exit 1
fi
echo "==> загружено (HTTP $HTTP)"

find "$WORK" -maxdepth 1 -type f \( -name 'dogodoc-*.tar.gz' -o -name 'dogodoc-*.tar.gz.enc' \) \
  -mtime +"$KEEP_LOCAL_DAYS" -delete 2>/dev/null || true
rm -f "$ENCRYPTED"
echo "==> готово"
