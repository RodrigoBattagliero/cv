// Comportamiento de la página. Los textos vienen de window.I18N (inyectado en cada idioma).
(() => {
  const T = window.I18N;
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Preferencias (tema y modo) guardadas para conservarlas al cambiar de idioma */
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  };

  /* Tema claro / oscuro */
  const themeBtn = $("#theme");
  const savedTheme = store.get("cv-theme");
  let theme = savedTheme === "light" || savedTheme === "dark" ? savedTheme : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  const applyTheme = (t) => {
    theme = t;
    root.dataset.theme = t;
    themeBtn.textContent = t === "dark" ? T.themeToLight : T.themeToDark;
  };
  themeBtn.addEventListener("click", () => {
    applyTheme(theme === "dark" ? "light" : "dark");
    store.set("cv-theme", theme);
  });
  applyTheme(theme);

  /* Modo reclutador */
  const recBtn = $("#recruiter");
  let recruiter = false;
  const applyView = (on) => {
    recruiter = on;
    if (on) root.dataset.view = "recruiter"; else delete root.dataset.view;
    recBtn.textContent = on ? T.recruiterOff : T.recruiterOn;
    recBtn.setAttribute("aria-pressed", String(on));
  };
  recBtn.addEventListener("click", () => {
    if (!recruiter) setFilter(null);
    applyView(!recruiter);
    store.set("cv-view", recruiter ? "recruiter" : "");
    scrollTo(0, 0);
  });
  applyView(store.get("cv-view") === "recruiter");

  /* Copiar al portapapeles */
  const legacyCopy = (text) => {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(el);
    el.select();
    try { document.execCommand("copy"); } catch { /* sin soporte */ }
    el.remove();
  };
  $$("[data-copy]").forEach((b) => {
    const label = b.textContent;
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); } catch { legacyCopy(b.dataset.copy); }
      b.textContent = T.copied;
      b.classList.add("ok");
      setTimeout(() => { b.textContent = label; b.classList.remove("ok"); }, 1800);
    });
  });

  /* Línea de tiempo y filtro por tecnología */
  const jobs = $$(".job");
  const chips = $$(".chips button");
  const bar = $("#filterbar");
  const norm = (t) => t.replace(/\d+$/, ""); // Symfony4 y Symfony2 cuentan como Symfony
  const canon = (t) => (T.aliases && T.aliases[t]) || norm(t);
  const has = (j, k) => j.dataset.tech.split(",").some((t) => norm(t) === k);
  const setOpen = (j, open) => {
    j.classList.toggle("open", open);
    $(".toggle", j).setAttribute("aria-expanded", String(open));
  };
  jobs.forEach((j) => $(".toggle", j).addEventListener("click", () => setOpen(j, !j.classList.contains("open"))));

  let active = null;
  function setFilter(k) {
    active = k;
    if (k) root.setAttribute("data-filtering", ""); else root.removeAttribute("data-filtering");
    chips.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tech === k)));
    jobs.forEach((j) => {
      const hit = !k || has(j, k);
      j.classList.toggle("dim", !hit);
      j.classList.toggle("hit", Boolean(k) && hit);
      $$(".tags li", j).forEach((li) => li.classList.toggle("on", Boolean(k) && canon(li.textContent) === k));
      setOpen(j, hit); // con filtro se abren solo los que coinciden; sin filtro, todos
    });
    bar.hidden = !k;
    bar.textContent = "";
    if (k) {
      const msg = document.createElement("span");
      msg.textContent = T.filtering.replace("{tech}", k);
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = T.clearFilter;
      clear.addEventListener("click", () => setFilter(null));
      bar.append(msg, clear);
    }
  }
  chips.forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.tech === active ? null : b.dataset.tech;
    setFilter(k);
    if (k) $("#experience").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }));

  /* Chat */
  const fab = $("#chat-fab"), panel = $("#chat-panel"), log = $("#chat-log"), form = $("#chat-form"), input = $("#chat-input");
  const history = [];
  let busy = false, greeted = false;
  const add = (role, text) => {
    const d = document.createElement("div");
    d.className = "m " + role;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };
  const toggleChat = (open) => {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    if (open) {
      if (!greeted) { greeted = true; add("bot", T.chatGreeting); }
      input.focus();
    }
  };
  fab.addEventListener("click", () => toggleChat(panel.hidden));
  $("#chat-close").addEventListener("click", () => { toggleChat(false); fab.focus(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || busy) return;
    add("user", q);
    input.value = "";
    history.push({ role: "user", content: q });
    busy = true;
    const waiting = add("bot", "…");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-10), lang: T.lang }),
      });
      const data = await res.json();
      if (!res.ok || !data.reply) throw new Error("chat_failed");
      waiting.textContent = data.reply;
      history.push({ role: "assistant", content: data.reply });
    } catch {
      waiting.textContent = T.chatError;
      history.pop();
    } finally {
      busy = false;
      log.scrollTop = log.scrollHeight;
    }
  });

  /* PDF / impresión: siempre en modo reclutador; al terminar se restaura lo que había */
  let printState = null;
  const enterPrint = () => {
    if (printState) return;
    printState = { view: recruiter, filter: active };
    if (active) setFilter(null);
    applyView(true);
  };
  const exitPrint = () => {
    if (!printState) return;
    const prev = printState;
    printState = null;
    applyView(prev.view);
    if (prev.filter) setFilter(prev.filter);
  };
  addEventListener("beforeprint", enterPrint);
  addEventListener("afterprint", exitPrint);
  const printQuery = matchMedia("print");
  if (printQuery.addEventListener) printQuery.addEventListener("change", (e) => (e.matches ? enterPrint() : exitPrint()));
})();
