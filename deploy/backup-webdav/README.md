# Бэкап Догодок на Synology (WebDAV)

Ежедневно в **02:00** (crontab) → `NAS/Backup/dogodoc/`  
файл `dogodoc-YYYY-MM-DD_HHMMSS.tar.gz.enc` (AES-256).

Конфиг: `/app/.backup-webdav.env`  
Рабочий каталог: `/app/var/backup-webdav-work`

## Содержимое (внутри расшифрованного tar.gz)

| В архиве | Назначение |
|----------|------------|
| `db/dogodoc.sql.gz` | Postgres (`docker compose … exec db pg_dump`) |
| `env/.env.production` | секреты |
| `storage/` | `STORAGE_DIR` (файлы договоров) |
| `logs/` | `./logs` на хосте |
| `nginx/nginx.conf` | reverse proxy |
| `MANIFEST.txt` | git SHA |

Код и Docker-образы — из GitHub / GHCR.

## Установка (на сервере)

```bash
cd /app && git pull --ff-only origin main
# при локальных правках в /app:
#   git fetch origin && git reset --hard origin/main
bash deploy/backup-webdav/install-backup.sh
nano .backup-webdav.env    # WEBDAV_PASSWORD= и ARCHIVE_PASSWORD=
bash deploy/backup-webdav/dogodoc-backup-webdav.sh
```

На Synology заранее: папка `Backup/dogodoc`.

## Расшифровка

```bash
export ARCHIVE_PASSWORD='…'
openssl enc -d -aes-256-cbc -pbkdf2 -in dogodoc-….tar.gz.enc -out dogodoc.tar.gz \
  -pass env:ARCHIVE_PASSWORD
tar -xzf dogodoc.tar.gz
```
