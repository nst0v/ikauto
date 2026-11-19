import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const token = "test-max-token-never-a-real-credential";
const webhookSecret = "test_webhook_secret_0123456789_abcdef";
const connectCode = "test_connect_0123456789";
const chatId = -987654321012;
const otherChatId = -987654321013;

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}

async function runPhp(args, env) {
  const child = spawn("php", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  return output;
}

function lead(overrides = {}) {
  return {
    form: "Контактная форма",
    name: "Тестовый клиент",
    phone: "+7 900 123-45-67",
    personalDataConsent: true,
    consentVersion: "2",
    consentAt: "2026-11-19T10:00:00.000Z",
    page: "https://ikauto.ru/#contacts",
    ...overrides,
  };
}

function connectUpdate({ chat = chatId, type = "chat", code = connectCode, bot = false } = {}) {
  return {
    update_type: "message_created",
    timestamp: Date.now(),
    message: {
      sender: { user_id: 123456, is_bot: bot, first_name: "Администратор" },
      recipient: { chat_id: chat, chat_type: type },
      body: { mid: `test-${Date.now()}-${Math.random()}`, text: `/connect ${code}` },
    },
  };
}

test("PHP lead delivery and authenticated MAX group binding", { timeout: 90_000 }, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "ikauto-max-test-"));
  const stateDir = join(temp, "private");
  const phpTemp = join(temp, "php-temp");
  const mailLog = join(temp, "mail.log");
  const mailFailure = join(temp, "mail-failure");
  const sendmail = join(temp, "sendmail");
  await mkdir(phpTemp);
  await writeFile(sendmail, '#!/bin/sh\ncat >> "$IK_TEST_MAIL_LOG"\nif [ -f "$IK_TEST_MAIL_FAIL" ]; then exit 75; fi\n', { mode: 0o700 });

  let requests = [];
  let failedMessages = 0;
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = body ? JSON.parse(body) : null;
    requests.push({ method: req.method, url: new URL(req.url, "http://max.test"), headers: req.headers, payload });
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/messages") && failedMessages > 0) {
      failedMessages -= 1;
      res.writeHead(503);
      res.end(JSON.stringify({ code: "test.unavailable", message: "Temporary test outage" }));
      return;
    }
    res.end(JSON.stringify({ message: { body: { mid: `sent-${requests.length}`, text: payload?.text } } }));
  });
  const apiUrl = await listen(api);
  const portProbe = createServer();
  await listen(portProbe);
  const phpPort = portProbe.address().port;
  await new Promise((done) => portProbe.close(done));
  const baseUrl = `http://127.0.0.1:${phpPort}`;
  const env = {
    ...process.env,
    // Never fall back to the developer's real bot configuration or destination.
    MAX_CONFIG_FILE: join(temp, "unused-config.php"),
    MAX_LIBRARY_FILE: join(root, "public/api/max.php"),
    MAX_BOT_TOKEN: token,
    MAX_WEBHOOK_SECRET: webhookSecret,
    MAX_CONNECT_CODE: connectCode,
    MAX_CHAT_ID: "",
    MAX_API_BASE_URL: apiUrl,
    MAX_STATE_DIR: stateDir,
    IK_TEST_MAIL_LOG: mailLog,
    IK_TEST_MAIL_FAIL: mailFailure,
  };
  const php = spawn("php", ["-d", `sys_temp_dir=${phpTemp}`, "-d", `sendmail_path=${sendmail}`, "-S", `127.0.0.1:${phpPort}`, "-t", join(root, "public")], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let phpOutput = "";
  php.stdout.on("data", (data) => { phpOutput += data; });
  php.stderr.on("data", (data) => { phpOutput += data; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (php.exitCode !== null) throw new Error(phpOutput);
      try {
        await fetch(`${baseUrl}/api/lead.php`, { signal: AbortSignal.timeout(500) });
        ready = true;
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 20));
      }
    }
    assert.ok(ready, `PHP test server did not start: ${phpOutput}`);

    const rateFile = join(phpTemp, `ikauto_lead_${createHash("sha256").update("ikauto-v1|127.0.0.1").digest("hex")}`);
    async function reset() {
      await rm(stateDir, { recursive: true, force: true });
      await mkdir(stateDir, { mode: 0o700 });
      await rm(rateFile, { force: true });
      await rm(mailFailure, { force: true });
      await writeFile(mailLog, "");
      requests = [];
      failedMessages = 0;
    }
    async function post(path, payload, extraHeaders = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      let json;
      try { json = JSON.parse(body); } catch { assert.fail(`Expected JSON, got HTTP ${response.status}: ${body}\n${phpOutput}`); }
      return { status: response.status, json };
    }
    function webhook(payload, secret = webhookSecret) {
      return post("/api/max-webhook.php", payload, secret ? { "X-Max-Bot-Api-Secret": secret } : {});
    }
    async function submit(payload = lead()) {
      await rm(rateFile, { force: true });
      return post("/api/lead.php", payload, { Origin: "https://ikauto.ru" });
    }
    async function bind() {
      const result = await webhook(connectUpdate());
      assert.equal(result.status, 200);
      requests = [];
    }
    function leadRequests() {
      return requests.filter((request) => request.payload?.text?.includes("Телефон: +7 900 123-45-67"));
    }
    async function pendingFiles() {
      try { return (await readdir(join(stateDir, "outbox"))).filter((name) => name.endsWith(".json")); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    }

    await t.test("rejects unsigned and incorrectly signed webhook requests", async () => {
      await reset();
      for (const secret of [null, "wrong-secret"]) {
        const result = await webhook(connectUpdate(), secret);
        assert.equal(result.status, 403);
        assert.equal(result.json.ok, false);
      }
      assert.equal(requests.length, 0);
      assert.equal((await submit()).status, 200);
      assert.equal(leadRequests().length, 0);
      assert.equal((await pendingFiles()).length, 1);
    });

    await t.test("does not bind a private dialog, a bot sender, a wrong code or a bare bot_added event", async () => {
      await reset();
      for (const update of [
        connectUpdate({ type: "dialog" }),
        connectUpdate({ bot: true }),
        connectUpdate({ code: "incorrect-code" }),
        { update_type: "bot_added", chat_id: chatId, is_channel: false, timestamp: Date.now() },
      ]) assert.equal((await webhook(update)).status, 200);
      assert.equal((await submit()).status, 200);
      assert.equal(leadRequests().length, 0);
      assert.equal((await pendingFiles()).length, 1);
    });

    await t.test("binds one group and cannot redirect leads to another group", async () => {
      await reset();
      await bind();
      assert.equal((await webhook(connectUpdate({ chat: otherChatId }))).status, 200);
      assert.equal((await submit()).status, 200);
      const delivered = leadRequests();
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].url.searchParams.get("chat_id"), String(chatId));
      assert.equal(delivered[0].headers.authorization, token);
      assert.equal(delivered[0].url.searchParams.has("access_token"), false);
      assert.equal(delivered[0].payload.text.includes(connectCode), false);
      assert.equal((await pendingFiles()).length, 0);
    });

    await t.test("an explicitly configured destination can deliver without webhook binding", async () => {
      await reset();
      assert.equal((await submit()).status, 200);
      assert.equal(leadRequests().length, 0);
      assert.equal((await pendingFiles()).length, 1);
      await runPhp([join(root, "scripts/max-bot.php"), "flush"], { ...env, MAX_CHAT_ID: String(chatId) });
      assert.equal(leadRequests().length, 1);
      assert.equal(leadRequests()[0].url.searchParams.get("chat_id"), String(chatId));
      assert.equal((await pendingFiles()).length, 0);
    });

    await t.test("all four forms send business details to MAX and retain form and consent metadata only in email", async () => {
      await reset();
      await bind();
      const forms = ["Консультация по подбору авто", "Контактная форма", "Консультация по автомобилю", "Квиз на скидку"];
      const emailMetadata = [
        "Согласие на обработку данных: да",
        "Версия согласия: 2",
        "Время согласия: 2026-11-19T10:00:00.000Z",
        "Страница: https://ikauto.ru/#contacts",
      ];
      for (const form of forms) {
        const result = await submit(lead({ form, city: "Владивосток", car: "Toyota Roomy", country: "Япония", budget: 1500000, message: "Нужен автомобиль\nБез пробега по РФ" }));
        assert.equal(result.status, 200);
        assert.equal(result.json.ok, true);
      }
      const delivered = leadRequests();
      assert.equal(delivered.length, 4);
      for (const { payload, url, method } of delivered) {
        assert.equal(method, "POST");
        assert.equal(url.pathname, "/messages");
        assert.equal(url.searchParams.get("chat_id"), String(chatId));
        for (const text of ["Тестовый клиент", "+7 900 123-45-67", "Владивосток", "Toyota Roomy", "Япония", "1 500 000", "Нужен автомобиль", "Без пробега по РФ"]) {
          assert.ok(payload.text.includes(text), `MAX message does not contain ${text}`);
        }
        for (const metadata of ["Форма:", "Согласие на обработку данных:", "Версия согласия:", "Время согласия:", "Страница:", "2026-11-19T10:00:00.000Z", "https://ikauto.ru/#contacts"]) {
          assert.equal(payload.text.includes(metadata), false, `MAX message must omit ${metadata}`);
        }
        assert.match(payload.text, /Получено: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2} \(МСК\)/);
        assert.ok([...payload.text].length <= 4000);
        assert.equal(payload.format, undefined, "Visitor text must not be interpreted as markup");
      }
      const emails = await readFile(mailLog, "utf8");
      assert.equal((emails.match(/To: kost_u@mail\.ru/g) || []).length, 4);
      assert.equal((emails.match(/Телефон: \+7 900 123-45-67/g) || []).length, 4);
      for (const form of forms) assert.ok(emails.includes(`Форма: ${form}`));
      for (const metadata of emailMetadata) assert.equal(emails.split(metadata).length - 1, 4, `Email must retain ${metadata} for every form`);
      assert.equal(emails.includes(token), false);
      assert.equal(emails.includes(connectCode), false);
    });

    await t.test("retains a failed MAX delivery and CLI flush retries it without repeating email", async () => {
      await reset();
      await bind();
      failedMessages = 1;
      assert.equal((await submit()).status, 200);
      assert.equal(leadRequests().length, 1);
      assert.equal((await pendingFiles()).length, 1);
      const emailBeforeRetry = await readFile(mailLog, "utf8");
      await runPhp([join(root, "scripts/max-bot.php"), "flush"], env);
      assert.equal(leadRequests().length, 2);
      assert.equal(leadRequests()[0].payload.text, leadRequests()[1].payload.text);
      assert.equal((await pendingFiles()).length, 0);
      assert.equal(await readFile(mailLog, "utf8"), emailBeforeRetry);
      await runPhp([join(root, "scripts/max-bot.php"), "flush"], env);
      assert.equal(leadRequests().length, 2, "An empty outbox must not resend accepted messages");
    });

    await t.test("keeps queued leads while the bot is removed and resumes only in its original group", async () => {
      await reset();
      await bind();
      assert.equal((await webhook({ update_type: "bot_removed", chat_id: chatId, timestamp: Date.now() })).status, 200);
      assert.equal((await submit()).status, 200);
      assert.equal(leadRequests().length, 0);
      assert.equal((await pendingFiles()).length, 1);
      await runPhp([join(root, "scripts/max-bot.php"), "flush"], env);
      assert.equal(leadRequests().length, 0);
      await webhook(connectUpdate({ chat: otherChatId }));
      assert.equal(leadRequests().length, 0);
      await webhook(connectUpdate());
      await runPhp([join(root, "scripts/max-bot.php"), "flush"], env);
      assert.equal(leadRequests().length, 1);
      assert.equal(leadRequests()[0].url.searchParams.get("chat_id"), String(chatId));
      assert.equal((await pendingFiles()).length, 0);
    });

    await t.test("bot_added restores only its approved group and ignores older lifecycle events", async () => {
      await reset();
      await bind();
      const removedAt = Date.now() + 100;
      assert.equal((await webhook({ update_type: "bot_removed", chat_id: chatId, timestamp: removedAt })).status, 200);
      assert.equal((await submit()).status, 200);
      assert.equal(leadRequests().length, 0);
      assert.equal((await pendingFiles()).length, 1);

      for (const update of [
        { update_type: "bot_added", chat_id: otherChatId, is_channel: false, timestamp: removedAt + 1 },
        { update_type: "bot_added", chat_id: chatId, is_channel: true, timestamp: removedAt + 2 },
        { update_type: "bot_added", chat_id: chatId, is_channel: false, timestamp: removedAt - 1 },
      ]) {
        assert.equal((await webhook(update)).status, 200);
        await runPhp([join(root, "scripts/max-bot.php"), "flush"], env);
        assert.equal(leadRequests().length, 0, "A foreign group, channel or older event must not reactivate delivery");
        assert.equal((await pendingFiles()).length, 1);
      }

      assert.equal((await webhook({ update_type: "bot_added", chat_id: chatId, is_channel: false, timestamp: removedAt + 3 })).status, 200);
      await runPhp([join(root, "scripts/max-bot.php"), "flush"], env);
      assert.equal(leadRequests().length, 1);
      assert.equal(leadRequests()[0].url.searchParams.get("chat_id"), String(chatId));
      assert.equal((await pendingFiles()).length, 0);

      assert.equal((await webhook({ update_type: "bot_removed", chat_id: chatId, timestamp: removedAt + 2 })).status, 200);
      assert.equal((await submit()).status, 200);
      assert.equal(leadRequests().length, 2, "A delayed removal older than the latest addition must not disable the group");
      assert.equal((await pendingFiles()).length, 0);
    });

    await t.test("accepts a durably queued MAX lead even if mail and MAX are temporarily unavailable", async () => {
      await reset();
      await bind();
      await writeFile(mailFailure, "fail");
      failedMessages = 1;
      const result = await submit();
      assert.equal(result.status, 200);
      assert.equal(result.json.ok, true);
      assert.equal((await pendingFiles()).length, 1);
      await runPhp([join(root, "scripts/max-bot.php"), "flush"], env);
      assert.equal((await pendingFiles()).length, 0);
    });

    await t.test("does not email or enqueue invalid or nonconsensual submissions", async () => {
      await reset();
      await bind();
      for (const payload of [lead({ personalDataConsent: false }), lead({ phone: "123" }), lead({ consentVersion: "0" })]) {
        const result = await submit(payload);
        assert.equal(result.status, 422);
        assert.equal(result.json.ok, false);
      }
      assert.equal(leadRequests().length, 0);
      assert.equal((await pendingFiles()).length, 0);
      assert.equal(await readFile(mailLog, "utf8"), "");
    });

    await t.test("rejects phone text even when it contains enough digits and never forwards it", async () => {
      await reset();
      await bind();
      for (const phone of ["тест", "тест +79040000000", "+79040000000abc", "++79040000000", "123", "1234567890123456"]) {
        const result = await submit(lead({ phone }));
        assert.equal(result.status, 422, `Invalid phone must be rejected: ${phone}`);
        assert.equal(result.json.ok, false);
        assert.match(result.json.error, /номер телефона/i);
      }
      assert.equal(requests.length, 0, "Invalid phone submissions must never call MAX");
      assert.equal((await pendingFiles()).length, 0);
      assert.equal(await readFile(mailLog, "utf8"), "");
    });
  } finally {
    if (php.exitCode === null) {
      php.kill("SIGTERM");
      await once(php, "exit");
    }
    await new Promise((done) => api.close(done));
    await rm(temp, { recursive: true, force: true });
  }
});
