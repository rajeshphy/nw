(() => {
  "use strict";

  const config = window.PORTAL_CONFIG || {};
  const portal = config.portal || {};
  const sources = (config.sources || []).filter(source => source.enabled !== false);
  const sourceMap = Object.fromEntries(sources.map(source => [source.id, source]));

  const nav = document.querySelector("#nav");
  const frame = document.querySelector("#frame");
  const message = document.querySelector("#message");
  const badge = document.querySelector("#badge");
  const dateElement = document.querySelector("#post-date");
  const titleElement = document.querySelector("#section-title");
  const external = document.querySelector("#external");
  const refresh = document.querySelector("#refresh");

  let manifest = null;
  let currentSource = null;

  const timezone = portal.timezone || "Asia/Kolkata";
  const locale = portal.locale || "en-GB";

  function todayISO() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date(`${date}T12:00:00+05:30`));
  }

  document.querySelector("#today").textContent =
    `${formatDate(todayISO())} · ${portal.timezone_label || timezone}`;

  function selectedSourceId() {
    const requested = new URLSearchParams(location.search).get("section");
    if (requested && sourceMap[requested]) return requested;
    if (portal.default_source && sourceMap[portal.default_source]) return portal.default_source;
    return sources[0]?.id || null;
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
        badge.textContent = item.date === todayISO() ? "TODAY" : "LATEST";
        badge.dataset.status = item.date === todayISO() ? "today" : "latest";
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
      const manifestURL = `${window.PORTAL_PATHS.manifest}?v=${Date.now()}`;
      const response = await fetch(manifestURL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
      manifest = await response.json();
      show(currentSource || selectedSourceId());
    } catch (error) {
      console.error(error);
      message.innerHTML =
        "Portal data could not be read. Run the included GitHub Action once, or run <code>python3 scripts/update_manifest.py</code> before local testing.";
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
