(() => {
  "use strict";

  const nav = document.querySelector("#nav");
  const frame = document.querySelector("#frame");
  const message = document.querySelector("#message");
  const badge = document.querySelector("#badge");
  const dateElement = document.querySelector("#post-date");
  const titleElement = document.querySelector("#section-title");
  const external = document.querySelector("#external");
  const refresh = document.querySelector("#refresh");

  let config = {};
  let portal = {};
  let sources = [];
  let sourceMap = {};
  let manifest = null;
  let currentSource = null;

  function todayISO() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: portal.timezone || "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat(portal.locale || "en-GB", {
      timeZone: portal.timezone || "Asia/Kolkata",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date(`${date}T12:00:00+05:30`));
  }

  function selectedSourceId() {
    const requested = new URLSearchParams(location.search).get("section");
    if (requested && sourceMap[requested]) return requested;
    if (portal.default_source && sourceMap[portal.default_source]) return portal.default_source;
    return sources[0]?.id || null;
  }

  function buildNavigation() {
    nav.innerHTML = "";
    for (const source of sources) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.key = source.id;
      button.append(document.createTextNode(source.label || source.id.toUpperCase()));
      if (source.subtitle) {
        const span = document.createElement("span");
        span.textContent = source.subtitle;
        button.append(span);
      }
      nav.append(button);
    }
  }

  function show(sourceId) {
    const source = sourceMap[sourceId];
    if (!source || !manifest) return;

    currentSource = sourceId;
    const item = manifest.sources?.[sourceId] || {};

    nav.querySelectorAll("button[data-key]").forEach(button => {
      const active = button.dataset.key === sourceId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });

    titleElement.textContent = source.heading || `${source.label} Brief`;
    dateElement.textContent = item.date ? formatDate(item.date) : "No post discovered";
    external.href = item.url || source.archive;

    const nextURL = new URL(location.href);
    nextURL.searchParams.set("section", sourceId);
    history.replaceState(null, "", nextURL);

    if (item.url) {
      frame.src = item.url;
      message.classList.add("hidden");
      if (item.stale) {
        badge.textContent = "LAST KNOWN";
        badge.dataset.status = "latest";
      } else {
        const isToday = item.date === todayISO();
        badge.textContent = isToday ? "TODAY" : "LATEST";
        badge.dataset.status = isToday ? "today" : "latest";
      }
    } else {
      frame.removeAttribute("src");
      message.classList.remove("hidden");
      message.innerHTML = `No individual post was discovered for <strong>${source.label}</strong>. ` +
        `<a href="${source.archive}" target="_blank" rel="noopener">Open its archive</a>.` +
        (item.error ? `<br><small>${item.error}</small>` : "");
      badge.textContent = "NOT FOUND";
      badge.dataset.status = "unavailable";
    }
  }

  async function load() {
    message.classList.remove("hidden");
    message.textContent = portal.loading_text || "Loading latest available brief…";
    badge.textContent = "CHECKING";
    badge.dataset.status = "checking";

    try {
      const stamp = Date.now();
      const [configResponse, manifestResponse] = await Promise.all([
        fetch(`data/config.json?v=${stamp}`, { cache: "no-store" }),
        fetch(`data/posts.json?v=${stamp}`, { cache: "no-store" })
      ]);
      if (!configResponse.ok) throw new Error(`Config returned ${configResponse.status}`);
      if (!manifestResponse.ok) throw new Error(`Manifest returned ${manifestResponse.status}`);

      config = await configResponse.json();
      manifest = await manifestResponse.json();
      portal = config.portal || {};
      sources = (config.sources || []).filter(source => source.enabled !== false);
      sourceMap = Object.fromEntries(sources.map(source => [source.id, source]));

      document.title = portal.title || "Daily Briefs";
      document.querySelector("#portal-title").textContent = portal.title || "Daily Briefs";
      document.querySelector("#portal-initials").textContent = portal.initials || "DB";
      document.querySelector("#today").textContent =
        `${formatDate(todayISO())} · ${portal.timezone_label || portal.timezone || "IST"}`;

      buildNavigation();
      show(currentSource || selectedSourceId());
    } catch (error) {
      console.error(error);
      message.innerHTML = "Portal data could not be read. Run the included GitHub Action once and confirm that <code>data/config.json</code> and <code>data/posts.json</code> exist.";
      badge.textContent = "UNAVAILABLE";
      badge.dataset.status = "unavailable";
    }
  }

  nav.addEventListener("click", event => {
    const button = event.target.closest("button[data-key]");
    if (button) show(button.dataset.key);
  });

  refresh.addEventListener("click", load);
  load();
})();
