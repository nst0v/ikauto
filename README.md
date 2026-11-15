# A2cars

Независимая статическая версия сайта `a2cars.pro`, пересобранная без Tilda. Изображения и шрифт хранятся локально; внешними остались только видео с Rutube и ссылки на мессенджеры.

## Запуск

```bash
npm install
npm run dev
```

Продакшен-сборка:

```bash
npm run build
npm run preview
```

Готовые файлы появятся в `dist/`.

## Формы

Без дополнительной настройки формы работают в демо-режиме и показывают подтверждение. Чтобы отправлять заявки в CRM, Telegram-бота или свой API, скопируйте `.env.example` в `.env` и укажите:

```dotenv
VITE_FORM_ENDPOINT=https://example.com/api/leads
```

Endpoint должен принимать `POST` с JSON.

## Проверка

```bash
npm run build
npm run test:visual
```

Исходные медиафайлы можно повторно скачать командой `npm run assets:fetch`.

