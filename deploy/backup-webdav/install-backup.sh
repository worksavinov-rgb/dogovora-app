#!/usr/bin/env bash
# Установка бэкапа Догодок → WebDAV.
#
#   bash /app/deploy/backup-webdav/install-backup.sh
#
# Пароль → /app/.backup-webdav.env
# Прогон:   bash /app/deploy/backup-webdav/dogodoc-backup-webdav.sh
# Лог cron: /app/var/log/backup-webdav.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/deploy/backup-webdav"
ENV_FILE="$ROOT/.backup-webdav.env"
WORK="$ROOT/var/backup-webdav-work"
CRON_MARK="dogodoc-backup-webdav"

test -f "$SRC/dogodoc-backup-webdav.sh" || { echo "нет $SRC"; exit 1; }

LOG_DIR="$ROOT/var/log"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backup-webdav.log"
# 02:00 — рядом с LiveTablo (01:00), до пульта/МедГрафа
CRON_LINE="0 2 * * *  bash $ROOT/deploy/backup-webdav/dogodoc-backup-webdav.sh >> $LOG_FILE 2>&1"

echo "=== скрипт ==="
chmod 755 "$SRC/dogodoc-backup-webdav.sh"

echo "=== каталоги ==="
mkdir -p "$WORK" "$ROOT/var"
chmod 700 "$WORK"

echo "=== $ENV_FILE ==="
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SRC/webdav.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "создан — вставьте WEBDAV_PASSWORD и ARCHIVE_PASSWORD"
else
  chmod 600 "$ENV_FILE"
  echo "уже есть — не перезаписываю"
fi

echo "=== crontab (02:00 ежедневно) ==="
existing="$(crontab -l 2>/dev/null || true)"
if echo "$existing" | grep -qE "$CRON_MARK|backup-webdav/dogodoc-backup-webdav\.sh"; then
  echo "строка бэкапа WebDAV в crontab уже есть"
else
  {
    echo "$existing"
    echo "# $CRON_MARK — полный бэкап на Synology WebDAV"
    echo "$CRON_LINE"
  } | grep -v '^$' | crontab -
  echo "добавлено в crontab"
fi

if ! command -v docker >/dev/null; then
  echo "ВНИМАНИЕ: docker не найден" >&2
fi

cat <<NEXT

=== дальше ===
1) На NAS создайте папку Backup/dogodoc (если ещё нет)
2) nano $ENV_FILE
   WEBDAV_PASSWORD=…
   ARCHIVE_PASSWORD=…
3) Пробный прогон:
   bash $SRC/dogodoc-backup-webdav.sh
4) Лог:
   tail -f $LOG_FILE
5) crontab -l
NEXT
