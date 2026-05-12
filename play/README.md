# Подготовка к Google Play

## Что собирает CI

GitHub Actions собирает подписанный Android App Bundle:

`dnevnik-play.aab`

Именно этот файл нужно загружать в Google Play Console.

## Где взять AAB

1. Открой GitHub repository.
2. Перейди в `Actions`.
3. Открой последний успешный run `Build Play AAB`.
4. Скачай artifact `dnevnik-play-aab`.
5. Внутри будет `dnevnik-play.aab` и `dnevnik-play.aab.sha256`.

## Что сделать в Play Console

1. Создай приложение.
2. Выбери `App`, не `Game`.
3. Выбери `Free`.
4. Включи Play App Signing.
5. Загрузи `dnevnik-play.aab` в Internal testing или Closed testing.
6. Заполни Store listing из `play/store-listing.md`.
7. Загрузи иконку `assets/icon/play-store-icon.png`.
8. Добавь минимум 2 скриншота телефона.
9. Заполни Data safety по `play/data-safety.md`.
10. Укажи Privacy Policy URL.

## Privacy Policy URL

В репозитории лежит файл:

`docs/privacy-policy.html`

Самый простой вариант:

1. В GitHub repository открой `Settings` -> `Pages`.
2. Source: `Deploy from a branch`.
3. Branch: `main`, folder: `/docs`.
4. После публикации используй URL:

`https://sergeyoooo4321-pixel.github.io/dnevnik/privacy-policy.html`

Если GitHub Pages недоступен, размести HTML на любом публичном сайте и укажи его URL в Play Console.

## Важный момент про ключ подписи

Если пользователи уже ставили APK из GitHub, Play Store не сможет обновить эту установку, если Play App Signing будет использовать другой app signing key.

Чтобы Play-версия ставилась поверх старого APK без удаления приложения, текущий release key из `.local-secrets/dnevnik-release.jks` должен быть app signing key в Play Console.

Если выбрать новый ключ Google Play, старые sideload-установки придётся удалить перед установкой версии из Play. Локальные данные при удалении приложения будут потеряны.

## Personal developer account

Если аккаунт разработчика личный и создан после 13 ноября 2023 года, перед production может потребоваться closed testing: минимум 12 opted-in testers в течение 14 дней подряд, затем заявка на production access.
