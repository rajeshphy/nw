(() => {
  "use strict";

  const OWNER = "rajeshphy";
  const SOURCES = {
    pib: { short: "PIB", title: "PIB Brief", repo: "pib", home: "https://rajeshphy.github.io/pib/" },
    dmk: { short: "DMK", title: "Dumka–Jharkhand Brief", repo: "dumka-jhar-news", home: "https://rajeshphy.github.io/dumka-jhar-news/" },
    pol: { short: "POL", title: "Political Brief", repo: "political-news", home: "https://rajeshphy.github.io/political-news/" },
    eco: { short: "ECO", title: "Economy Brief", repo: "economic-news", home: "https://rajeshphy.github.io/economic-news/" },
    phy: { short: "PHY", title: "Physics Brief", repo: "physics-news", home: "https://rajeshphy.github.io/physics-news/" }
  };

  const els = {
    frame: document.getElementById("brief-frame"), loading: document.getElementById("loading-panel"),
    loadingTitle: document.getElementById("loading-title"), loadingMessage: document.getElementById("loading-message"),
    sectionTitle: document.getElementById("section-title"), postDate: document.getElementById("post-date"),
    status: document.getElementById("status-pill"), today: document.getElementById("today-label"),
    external: document.getElementById("external-link"), refresh: document.getElementById("refresh-button"),
    buttons: [...document.querySelectorAll("[data-source]")]
  };

  let currentSource = "pib";
  let requestSequence = 0;

  function istParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    return Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  }
  function todayISO() { const p = istParts(); return `${p.year}-${p.month}-${p.day}`; }
  function prettyDate(iso) {
    const [y,m,d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" }).format(new Date(Date.UTC(y,m-1,d,12)));
  }
  function showLoading(source) {
    els.loading.hidden = false;
    els.loadingTitle.textContent = `Finding today’s ${source.short} brief`;
    els.loadingMessage.textContent = "Checking the GitHub repository for the post published today in Indian Standard Time.";
    els.status.className = "status-pill"; els.status.textContent = "Loading";
    els.postDate.textContent = "Checking today’s post…";
  }
  function showError(source, reason) {
    els.frame.removeAttribute("src"); els.loading.hidden = false;
    els.loadingTitle.textContent = `${source.short} brief could not be loaded`;
    els.loadingMessage.innerHTML = `${reason} <a href="${source.home}" target="_blank" rel="noopener">Open the ${source.short} archive</a>.`;
    els.status.className = "status-pill error"; els.status.textContent = "Unavailable";
    els.postDate.textContent = "Repository could not be read"; els.external.href = source.home;
  }

  function decodeBase64Unicode(value) {
    const bytes = Uint8Array.from(atob(value.replace(/\n/g, "")), c => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  }

  function frontMatterValue(markdown, key) {
    const block = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!block) return "";
    const match = block[1].match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
    return match ? match[1].trim() : "";
  }

  async function githubJSON(url, signal) {
    const response = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", signal });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    return response.json();
  }

  async function locatePost(source, signal) {
    const listURL = `https://api.github.com/repos/${OWNER}/${source.repo}/contents/_posts`;
    const files = await githubJSON(listURL, signal);
    const dated = files
      .filter(item => item.type === "file" && /\.(md|markdown)$/i.test(item.name))
      .map(item => {
        const match = item.name.match(/^(20\d{2})-(\d{2})-(\d{2})-(.+)\.(md|markdown)$/i);
        return match ? { item, date: `${match[1]}-${match[2]}-${match[3]}`, slug: match[4] } : null;
      })
      .filter(Boolean)
      .sort((a,b) => b.date.localeCompare(a.date));

    if (!dated.length) throw new Error("No dated Markdown posts were found in _posts");
    const chosen = dated.find(post => post.date === todayISO()) || dated[0];
    const detail = await githubJSON(chosen.item.url, signal);
    const markdown = decodeBase64Unicode(detail.content || "");
    let permalink = frontMatterValue(markdown, "permalink");
    if (permalink) {
      if (!permalink.startsWith("/")) permalink = `/${permalink}`;
      if (!/\.[a-z0-9]+$/i.test(permalink) && !permalink.endsWith("/")) permalink += "/";
    } else {
      const [year, month, day] = chosen.date.split("-");
      permalink = `/${source.repo}/${year}/${month}/${day}/${chosen.slug}.html`;
    }
    const url = new URL(permalink, "https://rajeshphy.github.io").href;
    return { date: chosen.date, url };
  }

  async function openSource(key, { push = true } = {}) {
    if (!SOURCES[key]) key = "pib";
    currentSource = key; const source = SOURCES[key]; const sequence = ++requestSequence;
    els.buttons.forEach(button => { const active = button.dataset.source === key; button.classList.toggle("active", active); button.setAttribute("aria-current", active ? "page" : "false"); });
    els.sectionTitle.textContent = source.title; els.external.href = source.home; showLoading(source);
    if (push) { const url = new URL(location.href); url.searchParams.set("section", key); history.pushState({ section: key }, "", url); }
    const controller = new AbortController();
    try {
      const post = await locatePost(source, controller.signal);
      if (sequence !== requestSequence) return controller.abort();
      const isToday = post.date === todayISO();
      els.frame.src = post.url; els.external.href = post.url;
      els.postDate.textContent = isToday ? prettyDate(post.date) : `Latest available: ${prettyDate(post.date)}`;
      els.status.className = `status-pill ${isToday ? "ready" : "latest"}`; els.status.textContent = isToday ? "Today" : "Latest";
      els.frame.onload = () => { if (sequence === requestSequence) els.loading.hidden = true; };
      window.setTimeout(() => { if (sequence === requestSequence) els.loading.hidden = true; }, 5000);
    } catch (error) {
      if (sequence !== requestSequence || error.name === "AbortError") return;
      console.error(error);
      showError(source, "The public GitHub repository could not be checked. This may be a temporary network or GitHub API limit issue.");
    }
  }

  els.today.textContent = `${prettyDate(todayISO())} · IST`;
  els.buttons.forEach(button => button.addEventListener("click", () => openSource(button.dataset.source)));
  els.refresh.addEventListener("click", () => openSource(currentSource, { push: false }));
  window.addEventListener("popstate", event => openSource(event.state?.section || new URLSearchParams(location.search).get("section") || "pib", { push: false }));
  openSource(new URLSearchParams(location.search).get("section") || "pib", { push: false });
})();
