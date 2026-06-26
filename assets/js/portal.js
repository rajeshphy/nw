(() => {
  "use strict";

  const SOURCES = {
    pib: {
      short: "PIB",
      title: "PIB Brief",
      site: "pib",
      filename: "pib-digest.html",
      home: "https://rajeshphy.github.io/pib/"
    },
    dmk: {
      short: "DMK",
      title: "Dumka–Jharkhand Brief",
      site: "dumka-jhar-news",
      filename: "dumka-brief.html",
      home: "https://rajeshphy.github.io/dumka-jhar-news/"
    },
    pol: {
      short: "POL",
      title: "Political Brief",
      site: "political-news",
      filename: "political-brief.html",
      home: "https://rajeshphy.github.io/political-news/"
    },
    eco: {
      short: "ECO",
      title: "Economy Brief",
      site: "economic-news",
      filename: "economy-brief.html",
      home: "https://rajeshphy.github.io/economic-news/"
    },
    phy: {
      short: "PHY",
      title: "Physics Brief",
      site: "physics-news",
      filename: "physics-brief.html",
      home: "https://rajeshphy.github.io/physics-news/"
    }
  };

  const els = {
    frame: document.getElementById("brief-frame"),
    loading: document.getElementById("loading-panel"),
    loadingTitle: document.getElementById("loading-title"),
    loadingMessage: document.getElementById("loading-message"),
    sectionTitle: document.getElementById("section-title"),
    postDate: document.getElementById("post-date"),
    status: document.getElementById("status-pill"),
    today: document.getElementById("today-label"),
    external: document.getElementById("external-link"),
    refresh: document.getElementById("refresh-button"),
    buttons: [...document.querySelectorAll("[data-source]")]
  };

  let currentSource = "pib";
  let loadTimer = null;

  function istParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);

    return Object.fromEntries(
      parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])
    );
  }

  function todayISO() {
    const p = istParts();
    return `${p.year}-${p.month}-${p.day}`;
  }

  function prettyDate(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  }

  function postURL(source, iso = todayISO()) {
    const [year, month, day] = iso.split("-");
    return `https://rajeshphy.github.io/${source.site}/${year}/${month}/${day}/${source.filename}`;
  }

  function setActive(key) {
    els.buttons.forEach(button => {
      const active = button.dataset.source === key;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
  }

  function showLoading(source) {
    els.loading.hidden = false;
    els.loadingTitle.textContent = `Opening today’s ${source.short} brief`;
    els.loadingMessage.textContent = "Using the current Indian Standard Time date. No GitHub API request is required.";
    els.status.className = "status-pill";
    els.status.textContent = "Loading";
  }

  function openSource(key, { push = true } = {}) {
    if (!SOURCES[key]) key = "pib";
    currentSource = key;
    const source = SOURCES[key];
    const iso = todayISO();
    const url = postURL(source, iso);

    clearTimeout(loadTimer);
    setActive(key);
    els.sectionTitle.textContent = source.title;
    els.postDate.textContent = prettyDate(iso);
    els.external.href = url;
    showLoading(source);

    if (push) {
      const browserURL = new URL(location.href);
      browserURL.searchParams.set("section", key);
      history.pushState({ section: key }, "", browserURL);
    }

    els.frame.onload = () => {
      clearTimeout(loadTimer);
      els.loading.hidden = true;
      els.status.className = "status-pill ready";
      els.status.textContent = "Today";
    };

    els.frame.onerror = () => {
      clearTimeout(loadTimer);
      els.loading.hidden = false;
      els.loadingTitle.textContent = `${source.short} brief could not be displayed`;
      els.loadingMessage.innerHTML = `The expected page is <a href="${url}" target="_blank" rel="noopener">${url}</a>. The daily workflow may not have published it yet.`;
      els.status.className = "status-pill error";
      els.status.textContent = "Unavailable";
    };

    // Assigning the deterministic URL avoids CORS and GitHub API limits.
    els.frame.src = `${url}?portal=${Date.now()}`;

    // A slow connection should not leave the overlay permanently visible.
    loadTimer = window.setTimeout(() => {
      els.loading.hidden = true;
      els.status.className = "status-pill ready";
      els.status.textContent = "Today";
    }, 8000);
  }

  els.today.textContent = `${prettyDate(todayISO())} · IST`;
  els.buttons.forEach(button => button.addEventListener("click", () => openSource(button.dataset.source)));
  els.refresh.addEventListener("click", () => openSource(currentSource, { push: false }));
  window.addEventListener("popstate", event => {
    const key = event.state?.section || new URLSearchParams(location.search).get("section") || "pib";
    openSource(key, { push: false });
  });

  openSource(new URLSearchParams(location.search).get("section") || "pib", { push: false });
})();
