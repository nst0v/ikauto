<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function clean_text(array $data, string $key, int $limit, bool $multiline = false): string
{
    $value = $data[$key] ?? '';
    if (!is_string($value) && !is_numeric($value)) {
        return '';
    }

    $text = trim((string) $value);
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text) ?? '';

    if ($multiline) {
        $text = preg_replace('/[ \t]+/u', ' ', $text) ?? '';
        $text = preg_replace('/\n{3,}/u', "\n\n", $text) ?? '';
    } else {
        $text = preg_replace('/\s+/u', ' ', $text) ?? '';
    }

    return function_exists('mb_substr') ? mb_substr($text, 0, $limit, 'UTF-8') : substr($text, 0, $limit);
}

function acquire_rate_limit()
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if ($ip === '') {
        return false;
    }

    $path = sys_get_temp_dir() . '/ikauto_lead_' . hash('sha256', 'ikauto-v1|' . $ip);
    $handle = @fopen($path, 'c+');
    if ($handle === false || !@flock($handle, LOCK_EX)) {
        if (is_resource($handle)) {
            fclose($handle);
        }
        return false;
    }

    rewind($handle);
    $lastRequest = (int) trim((string) stream_get_contents($handle));
    $now = time();

    if ($lastRequest > 0 && ($now - $lastRequest) < 15) {
        flock($handle, LOCK_UN);
        fclose($handle);
        respond(429, ['ok' => false, 'error' => 'Повторите отправку через несколько секунд.']);
    }

    return $handle;
}

function release_rate_limit($handle, bool $record): void
{
    if (!is_resource($handle)) {
        return;
    }

    if ($record) {
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, (string) time());
        fflush($handle);
    }

    flock($handle, LOCK_UN);
    fclose($handle);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, ['ok' => false, 'error' => 'Метод не поддерживается.']);
}

$origin = strtolower(rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/'));
$allowedOrigins = ['https://ikauto.ru', 'https://www.ikauto.ru'];
if ($origin !== '' && !in_array($origin, $allowedOrigins, true)) {
    respond(403, ['ok' => false, 'error' => 'Недопустимый источник запроса.']);
}

$contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
if ($contentLength > 24576) {
    respond(413, ['ok' => false, 'error' => 'Слишком большая заявка.']);
}

$contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
if (!str_starts_with($contentType, 'application/json')) {
    respond(415, ['ok' => false, 'error' => 'Ожидается JSON.']);
}

$rawBody = file_get_contents('php://input');
if ($rawBody === false || strlen($rawBody) > 24576) {
    respond(413, ['ok' => false, 'error' => 'Слишком большая заявка.']);
}

try {
    $data = json_decode($rawBody, true, 32, JSON_THROW_ON_ERROR);
} catch (JsonException) {
    respond(400, ['ok' => false, 'error' => 'Некорректный JSON.']);
}

if (!is_array($data)) {
    respond(400, ['ok' => false, 'error' => 'Некорректная заявка.']);
}

if (clean_text($data, 'website', 200) !== '') {
    respond(200, ['ok' => true]);
}

$consent = filter_var($data['personalDataConsent'] ?? false, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
if ($consent !== true) {
    respond(422, ['ok' => false, 'error' => 'Нужно согласие на обработку персональных данных.']);
}

$allowedForms = [
    'Тест-драйв',
    'Контактная форма',
    'Консультация по автомобилю',
    'Квиз на скидку',
];
$form = clean_text($data, 'form', 80);
if (!in_array($form, $allowedForms, true)) {
    $form = 'Форма с сайта';
}

$name = clean_text($data, 'name', 100);
$phone = clean_text($data, 'phone', 40);
$phoneDigits = preg_replace('/\D+/', '', $phone) ?? '';
if ($name === '' || strlen($phoneDigits) < 10 || strlen($phoneDigits) > 15) {
    respond(422, ['ok' => false, 'error' => 'Проверьте имя и номер телефона.']);
}

$city = clean_text($data, 'city', 120);
$car = clean_text($data, 'car', 160);
$message = clean_text($data, 'message', 2000, true);
$country = clean_text($data, 'country', 40);
if (!in_array($country, ['Корея', 'Япония', 'Китай'], true)) {
    $country = '';
}

$budget = '';
$budgetRaw = $data['budget'] ?? '';
if (is_numeric($budgetRaw)) {
    $budgetValue = (int) $budgetRaw;
    if ($budgetValue >= 0 && $budgetValue <= 100000000) {
        $budget = number_format($budgetValue, 0, ',', ' ') . ' руб.';
    }
}

$consentVersion = clean_text($data, 'consentVersion', 20);
$consentAt = clean_text($data, 'consentAt', 64);
if ($consentVersion !== '2' || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/', $consentAt)) {
    respond(422, ['ok' => false, 'error' => 'Не удалось подтвердить версию и время согласия.']);
}

$page = clean_text($data, 'page', 500);
if ($page !== '' && !preg_match('~^https://(?:www\.)?ikauto\.ru(?:[/?#:]|$)~i', $page)) {
    $page = 'https://ikauto.ru/';
}

$rateLimitHandle = acquire_rate_limit();

$lines = [
    'Новая заявка с сайта ikauto.ru',
    '',
    'Форма: ' . $form,
    'Имя: ' . $name,
    'Телефон: ' . $phone,
];

foreach ([
    'Город' => $city,
    'Автомобиль' => $car,
    'Страна' => $country,
    'Бюджет' => $budget,
] as $label => $value) {
    if ($value !== '') {
        $lines[] = $label . ': ' . $value;
    }
}

if ($message !== '') {
    $lines[] = '';
    $lines[] = 'Сообщение:';
    $lines[] = $message;
}

$receivedAt = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
$lines[] = '';
$lines[] = 'Согласие на обработку данных: да';
$lines[] = 'Версия согласия: ' . ($consentVersion !== '' ? $consentVersion : 'не указана');
$lines[] = 'Время согласия: ' . ($consentAt !== '' ? $consentAt : 'не указано');
$lines[] = 'Страница: ' . ($page !== '' ? $page : 'https://ikauto.ru/');
$lines[] = 'Получено: ' . $receivedAt->format('d.m.Y H:i:s') . ' (МСК)';

$recipient = 'kost_u@mail.ru';
$subjectText = '[ikauto.ru] Новая заявка — ' . $form;
$subject = '=?UTF-8?B?' . base64_encode($subjectText) . '?=';
$body = implode("\r\n", $lines);
$headers = implode("\r\n", [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'From: IK Auto <noreply@ikauto.ru>',
    'Reply-To: noreply@ikauto.ru',
    'X-Auto-Response-Suppress: All',
]);

$mailSent = @mail($recipient, $subject, $body, $headers);
release_rate_limit($rateLimitHandle, $mailSent);

if (!$mailSent) {
    error_log('ikauto lead mail transport failed');
    respond(502, ['ok' => false, 'error' => 'Почтовый сервис временно недоступен.']);
}

respond(200, ['ok' => true]);
