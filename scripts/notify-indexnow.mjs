import { readFile } from "node:fs/promises";

const origin = "https://ikauto.ru";
const configFile = new URL("../ikauto-private/indexnow.json", import.meta.url);

function siteUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Некорректный ${label}.`);
  }
  if (url.origin !== origin || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} должен использовать HTTPS и домен ikauto.ru без параметров и якоря.`);
  }
  return url;
}

async function loadConfig() {
  let contents;
  try {
    contents = await readFile(configFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Не удалось прочитать конфигурацию IndexNow.");
    return {};
  }
  try {
    const config = JSON.parse(contents);
    if (config === null || typeof config !== "object" || Array.isArray(config)) throw new Error();
    return config;
  } catch {
    throw new Error("Некорректный формат конфигурации IndexNow.");
  }
}

async function main() {
  const config = await loadConfig();
  const key = process.env.INDEXNOW_KEY ?? config.key;
  const location = process.env.INDEXNOW_KEY_LOCATION ?? config.keyLocation;
  if (typeof key !== "string" || !/^[a-zA-Z0-9-]{8,128}$/.test(key) || typeof location !== "string") {
    throw new Error("Настройте ключ IndexNow и адрес его проверочного файла в закрытой конфигурации или переменных INDEXNOW_KEY и INDEXNOW_KEY_LOCATION.");
  }
  const keyLocation = siteUrl(location, "Адрес проверочного файла");
  if (!/^\/[a-zA-Z0-9._-]+\.txt$/.test(keyLocation.pathname)) {
    throw new Error("Проверочный TXT-файл IndexNow должен находиться в корне сайта.");
  }
  const args = process.argv.slice(2);
  const urlList = [...new Set((args.length ? args : [`${origin}/`]).map((value) => siteUrl(value, "URL страницы").href))];
  if (urlList.length > 10000) throw new Error("За один запрос IndexNow допускается не более 10000 URL.");

  let verification;
  try {
    verification = await fetch(keyLocation, { redirect: "error", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error("Не удалось загрузить проверочный файл IndexNow.");
  }
  if (verification.status !== 200) {
    throw new Error(`Проверочный файл IndexNow недоступен (HTTP ${verification.status}).`);
  }
  let contents;
  try {
    contents = await verification.text();
  } catch {
    throw new Error("Не удалось прочитать проверочный файл IndexNow.");
  }
  if (contents.trim() !== key) {
    throw new Error("Содержимое проверочного файла IndexNow не совпадает с настроенным ключом.");
  }

  let response;
  try {
    response = await fetch("https://yandex.com/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: "ikauto.ru", key, keyLocation: keyLocation.href, urlList }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Не удалось отправить уведомление IndexNow в Яндекс.");
  }
  if (response.status === 200) {
    console.log(`Яндекс принял уведомление IndexNow о ${urlList.length} URL (HTTP 200).`);
  } else if (response.status === 202) {
    console.log(`Уведомление IndexNow о ${urlList.length} URL принято, проверка ключа ожидается (HTTP 202).`);
  } else {
    throw new Error(`Яндекс отклонил уведомление IndexNow (HTTP ${response.status}).`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
