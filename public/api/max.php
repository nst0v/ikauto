<?php

declare(strict_types=1);

namespace Ikauto\Max;

if (PHP_SAPI !== 'cli' && realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    http_response_code(404);
    exit;
}

function config_path(): string
{
    return getenv('MAX_CONFIG_FILE') ?: dirname(__DIR__, 2) . '/ikauto-private/max.php';
}

function config(): array
{
    $path = config_path();
    $values = is_file($path) ? require $path : [];
    if (!is_array($values)) {
        throw new \RuntimeException('Invalid MAX configuration');
    }
    $defaults = [
        'bot_token' => '',
        'webhook_secret' => '',
        'connect_code' => '',
        'chat_id' => '',
        'state_dir' => dirname($path) . '/max-state',
        'api_base_url' => 'https://platform-api2.max.ru',
        'ca_bundle' => '',
    ];
    foreach ($defaults as $key => $default) {
        $env = getenv('MAX_' . strtoupper($key));
        $values[$key] = trim((string) ($env !== false ? $env : ($values[$key] ?? $default)));
    }
    return $values;
}

function private_directory(string $path): void
{
    if (!is_dir($path) && !@mkdir($path, 0700, true) && !is_dir($path)) {
        throw new \RuntimeException('MAX private directory is not writable');
    }
    $realPath = realpath($path);
    $documentRoot = realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
    if (PHP_SAPI !== 'cli' && $documentRoot !== false && $realPath !== false
        && ($realPath === $documentRoot || str_starts_with($realPath, $documentRoot . '/'))) {
        throw new \RuntimeException('MAX storage must be outside the document root');
    }
    @chmod($path, 0700);
}

function write_json(string $path, array $data): void
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $temp = $path . '.' . bin2hex(random_bytes(8)) . '.tmp';
    $oldMask = umask(0077);
    try {
        if (@file_put_contents($temp, $json, LOCK_EX) !== strlen($json) || !@rename($temp, $path)) {
            throw new \RuntimeException('Cannot save MAX state');
        }
    } finally {
        @unlink($temp);
        umask($oldMask);
    }
}

function read_json(string $path): array
{
    if (!is_file($path)) {
        return [];
    }
    $contents = @file_get_contents($path);
    if ($contents === false) {
        throw new \RuntimeException('Cannot read MAX state');
    }
    $data = json_decode($contents, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($data)) {
        throw new \RuntimeException('Invalid MAX state');
    }
    return $data;
}

function lock_file(array $config, string $name, bool $nonblocking = false)
{
    private_directory($config['state_dir']);
    $oldMask = umask(0077);
    $handle = @fopen($config['state_dir'] . '/' . $name . '.lock', 'c+');
    umask($oldMask);
    if ($handle === false) {
        throw new \RuntimeException('Cannot open MAX lock');
    }
    if (!flock($handle, LOCK_EX | ($nonblocking ? LOCK_NB : 0))) {
        fclose($handle);
        return false;
    }
    return $handle;
}

function valid_chat_id($value): string
{
    if (!is_string($value) && !is_int($value)) {
        return '';
    }
    return preg_match('/^-?[1-9][0-9]{0,18}$/D', (string) $value) ? (string) $value : '';
}

function state(array $config): array
{
    $handle = lock_file($config, 'state');
    try {
        return read_json($config['state_dir'] . '/state.json') + [
            'chat_id' => valid_chat_id($config['chat_id']),
            'active' => valid_chat_id($config['chat_id']) !== '',
        ];
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}

function api(array $config, string $method, string $path, ?array $body = null): array
{
    if ($config['bot_token'] === '' || preg_match('/[\r\n]/', $config['bot_token'])) {
        throw new \RuntimeException('MAX token is missing or invalid');
    }
    if (!function_exists('curl_init')) {
        throw new \RuntimeException('MAX requires the PHP cURL extension');
    }
    $base = rtrim($config['api_base_url'], '/');
    if (!preg_match('~^https://[^/?#]+$~D', $base)
        && !preg_match('~^http://127\.0\.0\.1:[0-9]+$~D', $base)) {
        throw new \RuntimeException('Invalid MAX API URL');
    }
    $curl = curl_init($base . $path);
    $options = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => ['Authorization: ' . $config['bot_token'], 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ];
    if ($body !== null) {
        $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
    if ($config['ca_bundle'] !== '') {
        $options[CURLOPT_CAINFO] = $config['ca_bundle'];
    }
    curl_setopt_array($curl, $options);
    $response = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $errorNumber = curl_errno($curl);
    curl_close($curl);
    // Never include response bodies, URLs or credentials in logs or exceptions.
    if ($response === false || $status < 200 || $status >= 300) {
        throw new \RuntimeException('MAX API failed (HTTP ' . $status . ', cURL ' . $errorNumber . ')');
    }
    $data = json_decode($response, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($data) || isset($data['code']) || ($data['success'] ?? true) === false) {
        throw new \RuntimeException('MAX API rejected request');
    }
    return $data;
}

function send(array $config, string $chatId, string $text): void
{
    // All callers hold delivery.lock; persist spacing across concurrent PHP requests.
    $path = $config['state_dir'] . '/last-send';
    $lastSend = is_file($path) ? (float) file_get_contents($path) : 0;
    $delay = 0.55 - (microtime(true) - $lastSend);
    if ($delay > 0) {
        usleep((int) min($delay * 1000000, 550000));
    }
    @file_put_contents($path, (string) microtime(true), LOCK_EX);
    @chmod($path, 0600);
    $result = api($config, 'POST', '/messages?chat_id=' . rawurlencode($chatId) . '&disable_link_preview=true', [
        'text' => $text,
        'notify' => true,
    ]);
    if (empty($result['message']['body']['mid'])) {
        throw new \RuntimeException('MAX did not confirm message delivery');
    }
}

function queue(array $config, string $text): bool
{
    if ($config['bot_token'] === '') {
        return false;
    }
    $directory = $config['state_dir'] . '/outbox';
    private_directory($directory);
    // PHP without mbstring still counts UTF-8 characters rather than bytes.
    $characters = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);
    if ($characters === false || count($characters) > 4000) {
        throw new \RuntimeException('MAX message exceeds 4000 characters');
    }
    $id = sprintf('%020d', (int) (microtime(true) * 1000000)) . '-' . bin2hex(random_bytes(8));
    write_json($directory . '/' . $id . '.json', ['text' => $text, 'created_at' => gmdate('c')]);
    return true;
}

function pending_count(array $config): int
{
    return count(glob($config['state_dir'] . '/outbox/*.json') ?: []);
}

function flush(array $config, int $limit = 1): int
{
    if ($config['bot_token'] === '') {
        return 0;
    }
    $handle = lock_file($config, 'delivery', true);
    if ($handle === false) {
        return 0;
    }
    $sent = 0;
    try {
        $files = glob($config['state_dir'] . '/outbox/*.json') ?: [];
        sort($files, SORT_STRING);
        foreach (array_slice($files, 0, $limit) as $path) {
            $state = state($config);
            $chatId = valid_chat_id($state['chat_id']);
            if ($chatId === '' || empty($state['active'])) {
                break;
            }
            $item = read_json($path);
            if (!is_string($item['text'] ?? null)) {
                throw new \RuntimeException('Invalid MAX queue item');
            }
            send($config, $chatId, $item['text']);
            if (!@unlink($path)) {
                throw new \RuntimeException('Cannot remove delivered MAX queue item');
            }
            $sent++;
        }
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
    return $sent;
}

function handle_update(array $config, array $update): void
{
    $type = $update['update_type'] ?? '';
    $lifecycle = in_array($type, ['bot_added', 'bot_removed'], true);
    $recipient = $update['message']['recipient'] ?? [];
    $text = $update['message']['body']['text'] ?? '';
    $chatId = $lifecycle
        ? valid_chat_id($update['chat_id'] ?? null)
        : valid_chat_id($recipient['chat_id'] ?? null);
    $isConnect = $type === 'message_created'
        && ($recipient['chat_type'] ?? '') === 'chat'
        && ($update['message']['sender']['is_bot'] ?? true) === false
        && $chatId !== '' && is_string($text)
        && preg_match('/^\/connect(?:@[a-zA-Z0-9_]+)?\s+([a-zA-Z0-9_-]{12,128})\s*$/D', trim($text), $match)
        && strlen($config['connect_code']) >= 12
        && hash_equals($config['connect_code'], $match[1]);
    if (!$isConnect && !$lifecycle) {
        return;
    }
    $handle = lock_file($config, 'state');
    $connected = false;
    try {
        $path = $config['state_dir'] . '/state.json';
        $state = read_json($path) + [
            'chat_id' => valid_chat_id($config['chat_id']),
            'active' => valid_chat_id($config['chat_id']) !== '',
        ];
        $currentId = valid_chat_id($state['chat_id']);
        $timestamp = (int) ($update['timestamp'] ?? 0);
        if ($lifecycle && $chatId !== '' && $currentId === $chatId) {
            if ($timestamp < (int) ($state['lifecycle_timestamp'] ?? 0)) {
                return;
            }
            if ($type === 'bot_added' && ($update['is_channel'] ?? true) !== false) {
                return;
            }
            $state['active'] = $type === 'bot_added';
            $state['lifecycle_timestamp'] = $timestamp;
            write_json($path, $state);
        } elseif ($isConnect && ($currentId === '' || $currentId === $chatId)) {
            $messageId = (string) ($update['message']['body']['mid'] ?? '');
            if ($messageId !== '' && ($state['connection_message_id'] ?? null) === $messageId) {
                return; // Webhook retries must not send another confirmation.
            }
            $state['chat_id'] = $chatId;
            $state['active'] = true;
            $state['connection_message_id'] = $messageId;
            $state['lifecycle_timestamp'] = max($timestamp, (int) ($state['lifecycle_timestamp'] ?? 0));
            write_json($path, $state);
            $connected = true;
        }
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
    if ($connected) {
        // A durable confirmation also retries if MAX is temporarily unavailable.
        queue($config, 'IK Auto: чат подключён. Новые заявки с ikauto.ru будут приходить сюда.');
        try {
            flush($config, 1);
        } catch (\Throwable $error) {
            error_log('ikauto MAX confirmation queued: ' . get_class($error));
        }
    }
}
