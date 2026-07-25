# Контракт технических логов (dogovora)

Формат технических логов приложения «Догодок» для мониторинга ошибок.

## Файлы

| Файл | Формат |
|------|--------|
| `logs/app.log` | текст INFO+ |
| `logs/error.log` | **JSON Lines** только ERROR |

Ротация: 10 МБ × 10 бэкапов (`LOG_MAX_BYTES`, `LOG_BACKUP_COUNT`).

## Пример JSON

```json
{
  "ts": "2026-07-25T08:22:00.123Z",
  "level": "ERROR",
  "project": "dogovora",
  "service": "web",
  "env": "production",
  "logger": "web",
  "event": "auth.login_error",
  "message": "…",
  "error_type": "Error",
  "stack": "…",
  "fingerprint": "a1b2c3d4e5f67890",
  "request_id": "uuid",
  "job_id": null
}
```

### Поля

| Поле | Описание |
|------|----------|
| `project` | `dogovora` (`LOG_PROJECT`) |
| `service` | `web` \| `worker` (`LOG_SERVICE`) |
| `env` | `production` \| `development` … (`LOG_ENV`) |
| `event` | стабильный код (`auth.login_error`, `worker.job_failed`, …) |
| `fingerprint` | sha256(event\|error_type\|normalized_message)[:16] |
| `request_id` | корреляция; заголовок `X-Request-Id` |

## Код

```ts
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'

logger.error({
  event: 'auth.login_error',
  error: err,
  request_id: getRequestId(req),
})
```

Env: `LOG_*` в `.env.example`. Middleware проставляет `X-Request-Id`.
Не логировать пароли, JWT, ключи ИИ, полные тексты договоров.
