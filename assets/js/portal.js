(() => {
  "use strict";

  const nav = document.querySelector("#nav");
  const frame = document.querySelector("#frame");
  const message = document.querySelector("#message");
  const badge = document.querySelector("#badge");
  const titleElement = document.querySelector("#section-title");
  const external = document.querySelector("#external");
  const refresh = document.querySelector("#refresh");
  const portalTitle = document.querySelector("#portal-title");
  const todayElement = document.querySelector("#today");

  let portal = {};
  let sources = [];
  let sourceMap = {};
  let manifest = null;
  let currentSource = null;
  let dayMode = "today";

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

  function stripInlineComment(line) {
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
        quote = quote === char ? null : (quote || char);
      }
      if (char === "#" && !quote && (index === 0 || /\s/.test(line[index - 1]))) {
        return line.slice(0, index);
      }
    }
    return line;
  }

  // Parser for the intentionally simple data/portal.yml structure.
  function parsePortalYAML(text) {
    const result = { portal: {}, sources: [] };
    let section = null;
    let currentSourceItem = null;

    for (const originalLine of text.split(/\r?\n/)) {
      const cleanLine = stripInlineComment(originalLine);
      if (!cleanLine.trim()) continue;

      const indent = cleanLine.match(/^\s*/)[0].length;
      const line = cleanLine.trim();

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

  function zone() {
    return portal.timezone;
  }

  function locale() {
    return portal.locale;
  }

  function todayISO() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function yesterdayISO() {
    const date = new Date(`${todayISO()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat(locale(), {
      timeZone: zone(),
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date(`${date}T12:00:00Z`));
  }

  function formatManifestTime() {
    const value = manifest?.generated_at;
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(locale(), {
      timeZone: zone(),
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date).replace(/\s+/g, " ").toUpperCase();
  }

  function latestBadgeText() {
    const time = formatManifestTime();
    const label = portal.latest_label;
    switch (portal.latest_badge_mode) {
      case "label":
        return label;
      case "label_time":
        return time ? `${label}: ${time}` : label;
      case "time":
      default:
        return time || label;
    }
  }

  function dayLabel() {
    return dayMode === "yesterday" ? (portal.yesterday_text || "Yesterday") : portal.today_text;
  }

  function isStaticSource(source) {
    return source.kind === "static" || source.type === "static" || Boolean(source.url);
  }

  function canEmbedSource(source) {
    return source.embed !== false;
  }

  function showBlockedSource(source, item) {
    frame.removeAttribute("src");
    message.classList.remove("hidden");
    message.replaceChildren();

    const wrapper = document.createElement("div");
    wrapper.className = "message-card";

    const sentence = document.createElement("p");
    sentence.textContent = portal.cannot_embed_text || "This source blocks iframe display in browsers.";

    const link = document.createElement("a");
    link.href = item.url || source.url || source.archive || "#";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = portal.open_external_text || portal.external_label || "Open directly";

    wrapper.append(sentence, link);
    message.append(wrapper);

    badge.textContent = portal.link_text || "Link";
    badge.dataset.status = "blocked";
  }

  function sourceItem(sourceId) {
    const source = sourceMap[sourceId];
    if (!source) return {};

    if (isStaticSource(source)) {
      return {
        date: null,
        url: source.url || source.archive,
        title: source.heading || source.label,
        archive: source.url || source.archive,
        stale: false,
        static_link: true
      };
    }

    const entry = manifest?.sources?.[sourceId] || {};
    if (entry.today || entry.yesterday) {
      return entry[dayMode] || {};
    }
    return entry;
  }

  function selectedSourceId() {
    const requested = new URLSearchParams(location.search).get("section");
    if (requested && sourceMap[requested]) return requested;
    if (portal.default_source && sourceMap[portal.default_source]) return portal.default_source;
    return sources[0]?.id || null;
  }

  function applyPortalText() {
    document.title = portal.title;
    portalTitle.textContent = portal.title;
    todayElement.textContent = portal.timezone_label || "";

    refresh.title = portal.refresh_label;
    refresh.setAttribute("aria-label", portal.refresh_label);
    external.title = portal.external_label;
    external.setAttribute("aria-label", portal.external_label);
    nav.setAttribute("aria-label", portal.navigation_label);
    frame.title = portal.frame_title;
  }

  function buildNavigation() {
    nav.innerHTML = "";
    for (const source of sources) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.key = source.id;
      button.append(document.createTextNode(source.label));
      if (source.subtitle) {
        const subtitle = document.createElement("span");
        subtitle.textContent = source.subtitle;
        button.append(subtitle);
      }
      nav.append(button);
    }
  }

  function show(sourceId) {
    const source = sourceMap[sourceId];
    if (!source || !manifest) return;

    currentSource = sourceId;
    const item = sourceItem(sourceId);

    nav.querySelectorAll("button[data-key]").forEach(button => {
      const active = button.dataset.key === sourceId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });

    titleElement.textContent = source.heading;
    external.href = item.url || source.url || source.archive;

    const nextURL = new URL(location.href);
    nextURL.searchParams.set("section", sourceId);
    history.replaceState(null, "", nextURL);

    if (item.url && !canEmbedSource(source)) {
      showBlockedSource(source, item);
    } else if (item.url) {
      frame.src = item.url;
      message.classList.add("hidden");
      if (item.static_link) {
        badge.textContent = portal.link_text || "Link";
        badge.dataset.status = "link";
      } else {
        const expectedDate = dayMode === "yesterday" ? yesterdayISO() : todayISO();
        const isExpectedDay = item.date === expectedDate;
        badge.textContent = isExpectedDay && !item.stale ? dayLabel() : latestBadgeText();
        badge.dataset.status = isExpectedDay && !item.stale ? dayMode : "latest";
      }
    } else {
      frame.removeAttribute("src");
      message.classList.remove("hidden");
      message.replaceChildren();

      const wrapper = document.createElement("div");
      const sentence = document.createElement("p");
      sentence.append(`${portal.no_post_before} `);
      const strong = document.createElement("strong");
      strong.textContent = source.label;
      sentence.append(strong, ".");

      const link = document.createElement("a");
      link.href = source.archive || source.url || "#";
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = portal.open_archive_text;

      wrapper.append(sentence, link);
      if (item.error) {
        const details = document.createElement("small");
        details.textContent = item.error;
        wrapper.append(document.createElement("br"), details);
      }
      message.append(wrapper);

      badge.textContent = isStaticSource(source) ? (portal.link_text || "Link") : dayLabel();
      badge.dataset.status = "unavailable";
    }
  }

  async function loadConfiguration(stamp) {
    const yamlResponse = await fetch(`data/portal.yml?v=${stamp}`, { cache: "no-store" });
    if (!yamlResponse.ok) throw new Error(`portal.yml: ${yamlResponse.status}`);
    const parsed = parsePortalYAML(await yamlResponse.text());
    if (!parsed.portal.title || !parsed.sources.length) throw new Error("Invalid portal.yml");
    return parsed;
  }

  async function load() {
    try {
      const stamp = Date.now();
      const [config, manifestResponse] = await Promise.all([
        loadConfiguration(stamp),
        fetch(`data/posts.json?v=${stamp}`, { cache: "no-store" })
      ]);
      if (!manifestResponse.ok) throw new Error(`posts.json: ${manifestResponse.status}`);

      portal = config.portal;
      sources = config.sources.filter(source => source.enabled !== false);
      sourceMap = Object.fromEntries(sources.map(source => [source.id, source]));
      manifest = await manifestResponse.json();

      applyPortalText();
      message.textContent = portal.loading_text;
      badge.textContent = portal.checking_text;
      badge.dataset.status = "checking";
      buildNavigation();
      show(currentSource && sourceMap[currentSource] ? currentSource : selectedSourceId());
    } catch (error) {
      console.error(error);
      const fallback = portal.data_error_text || error.message;
      message.classList.remove("hidden");
      message.textContent = fallback;
      badge.textContent = portal.unavailable_text || "";
      badge.dataset.status = "unavailable";
    }
  }

  nav.addEventListener("click", event => {
    const button = event.target.closest("button[data-key]");
    if (button) show(button.dataset.key);
  });

  refresh.addEventListener("click", load);
  badge.addEventListener("click", () => {
    const source = sourceMap[currentSource];
    if (!source || isStaticSource(source)) return;
    dayMode = dayMode === "today" ? "yesterday" : "today";
    show(currentSource);
  });
  load();
})();
