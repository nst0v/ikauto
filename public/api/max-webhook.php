<?php

declare(strict_types=1);

require_once __DIR__ . '/max.php';

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function max_respond(int $status, bool $ok): void
{
    http_response_code($status);
    echo json_encode(['ok' => $ok]);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    max_respond(405, false);
}

try {
    $config = \Ikauto\Max\config();
    $secret = (string) ($_SERVER['HTTP_X_MAX_BOT_API_SECRET'] ?? '');
    if (strlen($config['webhook_secret']) < 32 || !hash_equals($config['webhook_secret'], $secret)) {
        max_respond(403, false);
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 262144) {
        max_respond(413, false);
    }
    $body = file_get_contents('php://input', false, null, 0, 262145);
    if ($body === false || strlen($body) > 262144) {
        max_respond(413, false);
    }
    try {
        $update = json_decode($body, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        max_respond(400, false);
    }
    if (!is_array($update)) {
        max_respond(400, false);
    }
    \Ikauto\Max\handle_update($config, $update);
    max_respond(200, true);
} catch (Throwable $error) {
    error_log('ikauto MAX webhook failed: ' . get_class($error));
    max_respond(503, false);
}
