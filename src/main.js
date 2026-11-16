const countries = ["Кореи", "Китая", "Японии"];
const typedCountry = document.querySelector(".typed-country");

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const PRIVACY_PREFERENCES_KEY = "ikautoPrivacyPreferences";
const PRIVACY_PREFERENCES_VERSION = 1;
const PERSONAL_DATA_CONSENT_VERSION = "2";

function readPrivacyPreferences() {
  try {
    const storedPreferences = JSON.parse(localStorage.getItem(PRIVACY_PREFERENCES_KEY));
    if (
      storedPreferences?.version === PRIVACY_PREFERENCES_VERSION &&
      storedPreferences.necessary === true &&
      typeof storedPreferences.externalMedia === "boolean" &&
      Date.parse(storedPreferences.expiresAt) > Date.now()
    ) {
      return storedPreferences;
    }
  } catch (error) {
    console.warn("Не удалось прочитать настройки приватности.", error);
  }

  return null;
}

let privacyPreferences = readPrivacyPreferences();

function setPrivacyElementVisibility(element, isVisible, openClass = "is-visible") {
  if (!element) return;
  element.hidden = !isVisible;
  element.classList.toggle(openClass, isVisible);
  element.setAttribute("aria-hidden", String(!isVisible));
}

function syncExternalMedia(externalMediaAllowed) {
  document.querySelectorAll("iframe[data-external-media]").forEach((iframe) => {
    const configuredSource = iframe.dataset.src;

    if (externalMediaAllowed && configuredSource) {
      if (iframe.getAttribute("src") !== configuredSource) iframe.setAttribute("src", configuredSource);
      iframe.hidden = false;
    } else {
      const currentSource = iframe.getAttribute("src");
      if (!configuredSource && currentSource) iframe.dataset.src = currentSource;
      iframe.removeAttribute("src");
      iframe.hidden = true;
    }

    const mediaContainer = iframe.closest("[data-external-media-container]") || iframe.parentElement;
    const placeholder = mediaContainer?.querySelector("[data-external-media-placeholder]");
    setPrivacyElementVisibility(placeholder, !externalMediaAllowed);
  });
}

const privacyBanner = document.querySelector("[data-privacy-banner]");
const privacySettings = document.querySelector("[data-privacy-settings]");
const externalMediaSetting = privacySettings?.querySelector("[data-privacy-external-media]");

function showPrivacyBanner(isVisible) {
  setPrivacyElementVisibility(privacyBanner, isVisible);
}

function closePrivacySettings() {
  setPrivacyElementVisibility(privacySettings, false, "is-open");
  syncBodyLock();
}

function openPrivacySettings() {
  if (!privacySettings) return;
  if (externalMediaSetting) externalMediaSetting.checked = Boolean(privacyPreferences?.externalMedia);
  setPrivacyElementVisibility(privacySettings, true, "is-open");
  syncBodyLock();
  window.setTimeout(() => externalMediaSetting?.focus({ preventScroll: true }), 40);
}

function savePrivacyPreferences(externalMedia) {
  const updatedAt = new Date();
  const expiresAt = new Date(updatedAt);
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  privacyPreferences = {
    version: PRIVACY_PREFERENCES_VERSION,
    necessary: true,
    externalMedia: Boolean(externalMedia),
    updatedAt: updatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  try {
    localStorage.setItem(PRIVACY_PREFERENCES_KEY, JSON.stringify(privacyPreferences));
  } catch (error) {
    console.warn("Не удалось сохранить настройки приватности.", error);
  }

  syncExternalMedia(privacyPreferences.externalMedia);
  showPrivacyBanner(false);
  closePrivacySettings();
  window.dispatchEvent(
    new CustomEvent("ikauto:privacy-preferences-changed", {
      detail: { ...privacyPreferences },
    }),
  );
}

document.querySelectorAll("[data-privacy-accept-all]").forEach((button) => {
  button.addEventListener("click", () => savePrivacyPreferences(true));
});

document.querySelectorAll("[data-privacy-reject-optional]").forEach((button) => {
  button.addEventListener("click", () => savePrivacyPreferences(false));
});

document.querySelectorAll("[data-privacy-open-settings]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openPrivacySettings();
  });
});

document.querySelectorAll("[data-privacy-save]").forEach((button) => {
  button.addEventListener("click", () => savePrivacyPreferences(Boolean(externalMediaSetting?.checked)));
});

document.querySelectorAll("[data-privacy-close]").forEach((button) => {
  button.addEventListener("click", closePrivacySettings);
});

document.querySelectorAll("[data-enable-external-media]").forEach((button) => {
  button.addEventListener("click", () => savePrivacyPreferences(true));
});

syncExternalMedia(Boolean(privacyPreferences?.externalMedia));
showPrivacyBanner(!privacyPreferences);

async function runCountryTyping() {
  if (!typedCountry || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let countryIndex = 0;
  while (document.body.contains(typedCountry)) {
    await wait(1600);
    const current = countries[countryIndex];
    for (let index = current.length - 1; index >= 0; index -= 1) {
      typedCountry.textContent = current.slice(0, index);
      await wait(55);
    }

    countryIndex = (countryIndex + 1) % countries.length;
    const next = countries[countryIndex];
    for (let index = 1; index <= next.length; index += 1) {
      typedCountry.textContent = next.slice(0, index);
      await wait(105);
    }
  }
}

runCountryTyping();

const menuButton = document.querySelector(".mobile-menu-button");
const drawer = document.querySelector(".mobile-drawer");
const drawerOverlay = document.querySelector(".mobile-drawer-overlay");

function syncBodyLock() {
  const hasOpenModal = Boolean(document.querySelector(".modal.is-open"));
  const hasOpenDrawer = drawer?.classList.contains("is-open");
  const hasOpenPrivacySettings = privacySettings?.classList.contains("is-open");
  document.body.classList.toggle("is-locked", hasOpenModal || hasOpenDrawer || hasOpenPrivacySettings);
}

function openDrawer() {
  if (!drawer || !drawerOverlay || !menuButton) return;
  drawer.classList.add("is-open");
  drawerOverlay.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  menuButton.classList.add("is-open");
  menuButton.setAttribute("aria-expanded", "true");
  menuButton.setAttribute("aria-label", "Закрыть меню");
  syncBodyLock();
}

function closeDrawer() {
  if (!drawer || !drawerOverlay || !menuButton) return;
  drawer.classList.remove("is-open");
  drawerOverlay.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
  menuButton.classList.remove("is-open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Открыть меню");
  syncBodyLock();
}

menuButton?.addEventListener("click", () => {
  if (drawer?.classList.contains("is-open")) closeDrawer();
  else openDrawer();
});

document.querySelectorAll("[data-close-drawer]").forEach((element) => {
  element.addEventListener("click", closeDrawer);
});

const chatWidget = document.querySelector(".chat-widget");
const chatToggle = document.querySelector(".chat-widget__toggle");
const chatLinks = document.querySelector(".chat-widget__links");

chatToggle?.addEventListener("click", () => {
  const isOpen = chatWidget.classList.toggle("is-open");
  chatToggle.setAttribute("aria-expanded", String(isOpen));
  chatToggle.setAttribute("aria-label", isOpen ? "Закрыть способы связи" : "Открыть способы связи");
  chatLinks?.setAttribute("aria-hidden", String(!isOpen));
});

const orderModal = document.querySelector("#order-modal");
const quizModal = document.querySelector("#quiz-modal");
let activeModal = null;
let modalTrigger = null;

function openModal(modal, trigger = document.activeElement) {
  if (!modal) return;
  if (activeModal && activeModal !== modal) closeModal(activeModal, false);
  closeDrawer();
  modalTrigger = trigger;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  activeModal = modal;
  syncBodyLock();
  window.setTimeout(() => {
    const focusTarget = modal.querySelector("input:not([type='hidden']), button:not([data-close-modal])");
    focusTarget?.focus({ preventScroll: true });
  }, 40);
}

function closeModal(modal = activeModal, restoreFocus = true) {
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  if (activeModal === modal) activeModal = null;
  syncBodyLock();
  if (restoreFocus && modalTrigger instanceof HTMLElement) modalTrigger.focus({ preventScroll: true });
}

document.querySelectorAll("[data-open-order]").forEach((button) => {
  button.addEventListener("click", () => openModal(orderModal, button));
});

document.querySelectorAll("[data-close-modal]").forEach((element) => {
  element.addEventListener("click", () => closeModal(element.closest(".modal")));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (privacySettings?.classList.contains("is-open")) closePrivacySettings();
    else if (activeModal) closeModal();
    else if (drawer?.classList.contains("is-open")) closeDrawer();
    else if (chatWidget?.classList.contains("is-open")) chatToggle?.click();
  }
});

const rangeInputs = document.querySelectorAll('input[type="range"]');

function updateRange(input) {
  const output = input.closest(".range-field")?.querySelector("output");
  if (output) output.textContent = input.value;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  input.style.setProperty("--range-progress", `${((value - min) / (max - min)) * 100}%`);
}

rangeInputs.forEach((input) => {
  updateRange(input);
  input.addEventListener("input", () => updateRange(input));
});

function formatRussianPhone(rawValue) {
  let digits = rawValue.replace(/\D/g, "");
  if (digits.startsWith("7") || digits.startsWith("8")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (!digits) return "";

  let result = `(${digits.slice(0, 3)}`;
  if (digits.length >= 3) result += ")";
  if (digits.length > 3) result += ` ${digits.slice(3, 6)}`;
  if (digits.length > 6) result += `-${digits.slice(6, 8)}`;
  if (digits.length > 8) result += `-${digits.slice(8, 10)}`;
  return result;
}

document.querySelectorAll('.phone-input input[type="tel"]').forEach((input) => {
  input.addEventListener("input", () => {
    input.value = formatRussianPhone(input.value);
  });
});

const quizSteps = [...document.querySelectorAll(".quiz-step")];
const quizProgress = document.querySelector(".quiz-progress span");
const quizStepLabel = document.querySelector(".quiz-footer__step b");
const quizPrev = document.querySelector(".quiz-prev");
const quizNext = document.querySelector(".quiz-next");
const quizSubmit = document.querySelector(".quiz-submit");
let quizStep = 1;

function renderQuizStep() {
  quizSteps.forEach((step) => {
    step.classList.toggle("is-active", Number(step.dataset.quizStep) === quizStep);
  });
  if (quizProgress) quizProgress.style.width = `${(quizStep / quizSteps.length) * 100}%`;
  if (quizStepLabel) quizStepLabel.textContent = `${quizStep}/${quizSteps.length}`;
  if (quizPrev) quizPrev.disabled = quizStep === 1;
  if (quizNext) quizNext.style.display = quizStep === quizSteps.length ? "none" : "flex";
  if (quizSubmit) quizSubmit.style.display = quizStep === quizSteps.length ? "block" : "none";
  quizModal?.querySelector(".quiz-panel")?.scrollTo({ top: 0, behavior: "smooth" });
}

function openQuiz(trigger = document.activeElement, reset = true) {
  if (reset) quizStep = 1;
  renderQuizStep();
  openModal(quizModal, trigger);
}

quizNext?.addEventListener("click", () => {
  if (quizStep < quizSteps.length) quizStep += 1;
  renderQuizStep();
});

quizPrev?.addEventListener("click", () => {
  if (quizStep > 1) quizStep -= 1;
  renderQuizStep();
});

renderQuizStep();

document.querySelectorAll("[data-open-quiz]").forEach((button) => {
  button.addEventListener("click", () => openQuiz(button));
});

let autoQuizOpened = sessionStorage.getItem("a2carsQuizShown") === "true";

function maybeOpenAutoQuiz() {
  if (autoQuizOpened || activeModal || drawer?.classList.contains("is-open")) return;
  autoQuizOpened = true;
  sessionStorage.setItem("a2carsQuizShown", "true");
  openQuiz(document.body, true);
}

const autoQuizTimer = window.setTimeout(maybeOpenAutoQuiz, 18000);

window.addEventListener(
  "scroll",
  () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable > 0 && window.scrollY / scrollable > 0.72) {
      window.clearTimeout(autoQuizTimer);
      maybeOpenAutoQuiz();
    }
  },
  { passive: true },
);

const formEndpoint = import.meta.env.VITE_FORM_ENDPOINT?.trim() || "/api/lead.php";

function getPersonalDataConsent(form) {
  return form.querySelector('[data-personal-data-consent], input[name="personalDataConsent"]');
}

function getFormStatus(form) {
  return form.querySelector(".form-status") || document.querySelector(".quiz-form-status");
}

function validatePersonalDataConsent(form) {
  const consent = getPersonalDataConsent(form);
  const status = getFormStatus(form);

  if (!(consent instanceof HTMLInputElement) || consent.type !== "checkbox") {
    if (status) {
      status.textContent = "Отправка недоступна: в форме отсутствует обязательное согласие на обработку персональных данных.";
      status.classList.add("is-visible");
    }
    console.error("Lead form is missing a personal-data consent checkbox.", form);
    return false;
  }

  consent.required = true;
  consent.setCustomValidity(consent.checked ? "" : "Подтвердите согласие на обработку персональных данных.");
  if (!consent.checked) consent.reportValidity();
  return consent.checked;
}

async function submitLeadForm(form) {
  const status = getFormStatus(form);
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton?.textContent;
  const payload = Object.fromEntries(new FormData(form).entries());
  if (payload.phone && form.querySelector(".phone-prefix")) payload.phone = `+7 ${payload.phone}`;
  payload.personalDataConsent = true;
  payload.consentVersion = PERSONAL_DATA_CONSENT_VERSION;
  payload.consentAt = new Date().toISOString();
  payload.form = form.dataset.formName || "Форма с сайта";
  payload.page = window.location.href;

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Отправляем…";
  }
  if (status) {
    status.classList.remove("is-visible");
    status.textContent = "";
  }

  try {
    const response = await fetch(formEndpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) throw new Error(result?.error || `HTTP ${response.status}`);

    if (status) {
      status.textContent = "Спасибо! Заявка принята, мы свяжемся с вами.";
      status.classList.add("is-visible");
    }
    form.reset();
    rangeInputs.forEach(updateRange);
  } catch (error) {
    console.error(error);
    if (status) {
      status.textContent = "Не удалось отправить заявку. Позвоните нам: +7 904 329-49-86.";
      status.classList.add("is-visible");
    }
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }
}

document.querySelectorAll(".lead-form").forEach((form) => {
  const consent = getPersonalDataConsent(form);
  if (consent instanceof HTMLInputElement && consent.type === "checkbox") {
    consent.required = true;
    consent.addEventListener("change", () => consent.setCustomValidity(""));
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validatePersonalDataConsent(form)) return;
    if (!form.reportValidity()) return;
    submitLeadForm(form);
  });
});
