# Дневник

Минималистичный личный дневник для Android. Полностью оффлайн — все данные хранятся только на твоём телефоне.

## Что умеет

- Оценка дня от 1 до 10 звёзд
- Поля «Что сделал», «Что улучшить», «Заметки»
- История записей по датам
- Поиск, статистика и редактирование прошлых дней из истории
- Напоминания с системными уведомлениями
- Без рекламы, аналитики, трекеров и встроенных сетевых запросов

## Google Play

Проект подготовлен под публикацию в Google Play. GitHub Actions собирает подписанный Android App Bundle `dnevnik-play.aab`.

Инструкции для Play Console лежат в [`play/README.md`](play/README.md).

## Безопасность

- In-app updater удалён: обновления идут через Google Play.
- Разрешения `INTERNET`, `RECORD_AUDIO` и `USE_EXACT_ALARM` не используются в Play-сборке.
- В HTML задан CSP с `connect-src 'none'`.
- Android manifest в CI патчится с `allowBackup=false` и `usesCleartextTraffic=false`.

## Разработка

```bash
npm ci
npm run check
```

## Структура

```
www/                    # веб-приложение (HTML/CSS/JS)
  index.html
  style.css
  app.js
assets/                 # иконки Play/Android
docs/                   # privacy policy для публикации
play/                   # материалы для Play Console
capacitor.config.json   # конфиг Capacitor
package.json            # зависимости
scripts/                # локальные проверки и CI-патчи Android
.github/workflows/      # автосборка AAB
```

`android/` генерируется в CI и не коммитится.
