<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$library = getenv('MAX_LIBRARY_FILE');
if (!$library) {
    foreach (['/../public/api/max.php', '/../dist/api/max.php', '/../api/max.php'] as $candidate) {
        if (is_file(__DIR__ . $candidate)) {
            $library = __DIR__ . $candidate;
            break;
        }
    }
}
if (!$library || !is_file($library)) {
    fwrite(STDERR, "Не найдена библиотека api/max.php. Укажите MAX_LIBRARY_FILE.\n");
    exit(1);
}
require_once $library;

try {
    $command = $argv[1] ?? 'help';
    if ($command === 'init') {
        $path = \Ikauto\Max\config_path();
        if (is_file($path)) {
            throw new RuntimeException('Конфигурация уже существует; повторная инициализация запрещена.');
        }
        $token = getenv('MAX_BOT_TOKEN') ?: '';
        if ($token === '') {
            $interactive = function_exists('stream_isatty') && stream_isatty(STDIN);
            if ($interactive) {
                fwrite(STDERR, 'Токен MAX (ввод скрыт): ');
                system('stty -echo');
            }
            try {
                $token = trim((string) fgets(STDIN));
            } finally {
                if ($interactive) {
                    system('stty echo');
                    fwrite(STDERR, "\n");
                }
            }
        }
        if ($token === '' || preg_match('/\s/', $token)) {
            throw new RuntimeException('Токен не указан или содержит пробельные символы.');
        }
        \Ikauto\Max\private_directory(dirname($path));
        $values = [
            'bot_token' => $token,
            'webhook_secret' => bin2hex(random_bytes(32)),
            'connect_code' => bin2hex(random_bytes(12)),
            'state_dir' => dirname($path) . '/max-state',
        ];
        $oldMask = umask(0077);
        $handle = @fopen($path, 'x');
        umask($oldMask);
        if ($handle === false) {
            throw new RuntimeException('Не удалось создать закрытый конфигурационный файл.');
        }
        try {
            $contents = "<?php\n\nreturn " . var_export($values, true) . ";\n";
            if (fwrite($handle, $contents) !== strlen($contents)) {
                throw new RuntimeException('Не удалось записать конфигурацию.');
            }
        } finally {
            fclose($handle);
        }
        fwrite(STDOUT, "Конфигурация создана: " . $path . "\nКоманда для группового чата: /connect " . $values['connect_code'] . "\n");
        exit(0);
    }

    if ($command === 'help') {
        fwrite(STDOUT, "php scripts/max-bot.php init|status|connect-command|subscribe <https-url>|flush|test\n");
        exit(0);
    }

    $config = \Ikauto\Max\config();
    if ($config['bot_token'] === '') {
        throw new RuntimeException('Сначала выполните init или настройте MAX_BOT_TOKEN.');
    }
    if ($command === 'connect-command') {
        if (strlen($config['connect_code']) < 12) {
            throw new RuntimeException('Код подключения не настроен.');
        }
        fwrite(STDOUT, '/connect ' . $config['connect_code'] . "\n");
    } elseif ($command === 'status') {
        $bot = \Ikauto\Max\api($config, 'GET', '/me');
        $state = \Ikauto\Max\state($config);
        fwrite(STDOUT, json_encode([
            'bot' => $bot['username'] ?? $bot['first_name'] ?? $bot['user_id'] ?? null,
            'chat_id' => $state['chat_id'],
            'active' => (bool) $state['active'],
            'pending' => \Ikauto\Max\pending_count($config),
        ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
    } elseif ($command === 'subscribe') {
        $url = $argv[2] ?? '';
        $parts = parse_url($url);
        if (!filter_var($url, FILTER_VALIDATE_URL) || ($parts['scheme'] ?? '') !== 'https'
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])
            || isset($parts['query']) || isset($parts['fragment'])) {
            throw new RuntimeException('Укажите публичный HTTPS URL webhook без порта, пароля и query-параметров.');
        }
        if (!preg_match('/^[a-zA-Z0-9_-]{32,256}$/D', $config['webhook_secret'])) {
            throw new RuntimeException('Нужно настроить MAX_WEBHOOK_SECRET (32–256 символов A–Z, a–z, 0–9, _ или -).');
        }
        $result = \Ikauto\Max\api($config, 'POST', '/subscriptions', [
            'url' => $url,
            'update_types' => ['bot_added', 'bot_removed', 'message_created'],
            'secret' => $config['webhook_secret'],
        ]);
        if (($result['success'] ?? false) !== true) {
            throw new RuntimeException('MAX не подтвердил подписку.');
        }
        fwrite(STDOUT, "Webhook подключён: " . $url . "\n");
    } elseif ($command === 'flush') {
        $sent = \Ikauto\Max\flush($config, 25);
        fwrite(STDOUT, 'Отправлено: ' . $sent . '; в очереди: ' . \Ikauto\Max\pending_count($config) . "\n");
    } elseif ($command === 'test') {
        $state = \Ikauto\Max\state($config);
        if (empty($state['active']) || \Ikauto\Max\valid_chat_id($state['chat_id']) === '') {
            throw new RuntimeException('Сначала подключите групповой чат командой /connect.');
        }
        \Ikauto\Max\queue($config, 'Тест IK Auto: уведомления о заявках с ikauto.ru подключены.');
        \Ikauto\Max\flush($config, 25);
        fwrite(STDOUT, "Тест поставлен на отправку; в очереди: " . \Ikauto\Max\pending_count($config) . "\n");
    } else {
        throw new RuntimeException('Неизвестная команда; используйте help.');
    }
} catch (Throwable $error) {
    // Internal messages never contain the API response or token.
    fwrite(STDERR, $error->getMessage() . "\n");
    exit(1);
}
