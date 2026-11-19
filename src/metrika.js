const counterId = 114366595;
const scriptUrl = `https://mc.yandex.ru/metrika/tag.js?id=${counterId}`;
let script;
let ready = false;
let allowed = false;
let pendingLeads = 0;

function send(method, ...args) {
  try {
    window.ym(counterId, method, ...args);
  } catch (error) {
    console.warn("Команда Яндекс Метрики не выполнена.", error);
  }
}

function start() {
  send("init", {
    ssr: true,
    clickmap: true,
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
    webvisor: false,
  });
  for (let i = 0; i < pendingLeads; i++) send("reachGoal", "lead_success");
  pendingLeads = 0;
}

export function allowAnalytics(value) {
  if (allowed === value) return;
  allowed = value;

  if (!allowed) {
    pendingLeads = 0;
    if (ready) send("destruct");
    return;
  }

  if (ready) {
    start();
    return;
  }
  if (script) return;
  // The tag uses the standard ym command queue during bootstrap.
  window.ym ||= function () {
    (window.ym.a ||= []).push(arguments);
  };
  window.ym.l ||= Date.now();
  script = document.createElement("script");
  script.async = true;
  script.src = scriptUrl;
  script.onload = () => {
    ready = true;
    if (allowed) start();
  };
  script.onerror = () => {
    script.remove();
    script = undefined;
    pendingLeads = 0;
  };
  document.head.append(script);
}

export function trackAcceptedLead() {
  if (!allowed || !script) return;
  if (ready) send("reachGoal", "lead_success");
  else pendingLeads++;
}
