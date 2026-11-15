const countries = ["Кореи", "Китая", "Японии"];
const typedCountry = document.querySelector(".typed-country");

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

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
  document.body.classList.toggle("is-locked", hasOpenModal || hasOpenDrawer);
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
    if (activeModal) closeModal();
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

const formEndpoint = import.meta.env.VITE_FORM_ENDPOINT?.trim();

async function submitLeadForm(form) {
  const status = form.querySelector(".form-status") || document.querySelector(".quiz-form-status");
  const submitButton = form.querySelector('button[type="submit"]');
  const originalText = submitButton?.textContent;
  const payload = Object.fromEntries(new FormData(form).entries());
  if (payload.phone && form.querySelector(".phone-prefix")) payload.phone = `+7 ${payload.phone}`;
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
    if (formEndpoint) {
      const response = await fetch(formEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } else {
      await wait(450);
    }

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
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submitLeadForm(form);
  });
});
