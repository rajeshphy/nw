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

  function parseScalar(raw) {
    const value = raw.trim();
    if (value === "") return "";
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null" || value === "~") return null;
    if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }

  // Small YAML reader for this portal's deliberately simple portal.yml structure.
  // It supports the top-level "portal" mapping and the "sources" list of mappings.
  function parsePortalYAML(text) {
    const result = { portal: {}, sources: [] };
    let section = null;
    let currentSourceItem = null;

    for (const originalLine of text.split(/\r?\n/)) {
      const withoutComment = originalLine.replace(/\s+#.*$/, "");
      if (!withoutComment.trim()) continue;

      const indent = withoutComment.match(/^\s*/)[0].length;
      const line = withoutComment.trim();

      if (indent === 0 && line === "portal:") {
        section = "portal";
        currentSourceItem = null;
        continue;
      }
      if (indent === 0 && line === "sources:") {
        section = "sources";
        currentSourceItem = null;
        continue;
      }

      if (section === "portal" && indent >= 2) {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) result.portal[match[1].trim()] = parseScalar(match[2]);
        continue;
      }

      if (section === "sources" && indent >= 2) {
        if (line.startsWith("- ")) {
          currentSourceItem = {};
          result.sources.push(currentSourceItem);
          const rest = line.slice(2).trim();
          const match = rest.match(/^([^:]+):\s*(.*)$/);
          if (match) currentSourceItem[match[1].trim()] = parseScalar(match[2]);
        } else if (currentSourceItem) {
          const match = line.match(/^([^:]+):\s*(.*)$/);
          if (match) currentSourceItem[match[1].trim()] = parseScalar(match[2]);
        }
      }
    }
    return result;
  }

  function todayISO() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: portal.timezone || "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat(portal.locale || "en-GB", {
      timeZone: portal.timezone || "Asia/Kolkata",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date(`${date}T12:00:00+05:30`));
  }

  function formatManifestTime() {
    const value = manifest?.generated_at;
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(portal.locale || "en-GB", {
      timeZone: portal.timezone || "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date).replace(/\s+/g, " ");
  }

  function latestBadgeText() {
    const time = formatManifestTime();
    return time ? `${time}` : "Latest";
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
      const isToday = item.date === todayISO();
      badge.textContent = isToday && !item.stale ? "TODAY" : latestBadgeText();
      badge.dataset.status = isToday && !item.stale ? "today" : "latest";
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

  async function loadConfiguration(stamp) {
    // portal.yml is now the live source of menu labels, order, enabled state,
    // headings and portal identity. config.json is only a compatibility fallback.
    try {
      const response = await fetch(`_data/portal.yml?v=${stamp}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`YAML returned ${response.status}`);
      const parsed = parsePortalYAML(await response.text());
      if (!parsed.sources.length) throw new Error("No sources found in portal.yml");
      return parsed;
    } catch (yamlError) {
      console.warn("Could not read portal.yml; using config.json", yamlError);
      const response = await fetch(`data/config.json?v=${stamp}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Config returned ${response.status}`);
      return response.json();
    }
  }

  async function load() {
    message.classList.remove("hidden");
    message.textContent = portal.loading_text || "Loading latest available brief…";
    badge.textContent = "CHECKING";
    badge.dataset.status = "checking";

    try {
      const stamp = Date.now();
      const [loadedConfig, manifestResponse] = await Promise.all([
        loadConfiguration(stamp),
        fetch(`data/posts.json?v=${stamp}`, { cache: "no-store" })
      ]);
      if (!manifestResponse.ok) throw new Error(`Manifest returned ${manifestResponse.status}`);

      config = loadedConfig;
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
      show(currentSource && sourceMap[currentSource] ? currentSource : selectedSourceId());
    } catch (error) {
      console.error(error);
      message.innerHTML = "Portal data could not be read. Confirm that <code>_data/portal.yml</code> and <code>data/posts.json</code> exist, then run the included GitHub Action once.";
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
