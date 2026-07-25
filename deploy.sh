#!/bin/bash
set -e

echo "=== Догодок — деплой на сервер ==="

# Обновляем код
git pull origin main

# Собираем образ
docker compose -f docker-compose.prod.yml build web

# Применяем миграции БД
docker compose -f docker-compose.prod.yml run --rm web \
  node -e "const { execSync } = require('child_process'); execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: '/app/apps/web' })"

# Поднимаем сервисы
docker compose -f docker-compose.prod.yml up -d

echo "=== Готово! https://app.dogodoc.ru ==="
echo "Логи: ./logs/app.log и ./logs/error.log (tail -f logs/app.log)"
