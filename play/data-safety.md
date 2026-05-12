# Google Play Data Safety

Рекомендуемые ответы для текущей версии приложения.

## Data collection and sharing

- Does your app collect or share any of the required user data types? `No`
- Is all of the user data collected by your app encrypted in transit? `Not applicable`
- Do you provide a way for users to request that their data is deleted? `Not applicable`

Обоснование: приложение работает оффлайн, не имеет встроенных сетевых запросов, не содержит аналитики, рекламы, серверной синхронизации и не отправляет пользовательские записи наружу.

## Security practices

- Data is encrypted in transit: `Not applicable`
- Users can request data deletion: `Not applicable`
- Independent security review: `No`

## Permissions declaration

Текущая Play-сборка не добавляет `INTERNET`, `RECORD_AUDIO` и `USE_EXACT_ALARM`.

Может использоваться системное разрешение уведомлений для локальных напоминаний.
