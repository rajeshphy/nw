#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timedelta
from html.parser import HTMLParser
import json
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "data" / "portal.yml"
OUTPUT_PATH = ROOT / "data" / "posts.json"
CONFIG_JSON_PATH = ROOT / "data" / "config.json"
POST_FILE = re.compile(r"^(20\d{2})-(\d{2})-(\d{2})-(.+)\.(?:md|markdown)$", re.I)
DATE_IN_URL = re.compile(r"/(20\d{2})/(\d{2})/(\d{2})/")
DATE_ANYWHERE = re.compile(r"(20\d{2})[-/](\d{2})[-/](\d{2})")
PERMALINK = re.compile(r"^permalink:\s*[\"']?([^\"'\n]+)", re.M)
TITLE = re.compile(r"^title:\s*[\"']?(.+?)[\"']?\s*$", re.M)


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict] = []
        self._current: dict | None = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            data = dict(attrs)
            href = data.get("href")
            if href:
                self._current = {"href": href, "text": ""}

    def handle_data(self, data):
        if self._current is not None:
            self._current["text"] += data

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._current is not None:
            self._current["text"] = " ".join(self._current["text"].split())
            self.links.append(self._current)
            self._current = None


def fetch_text(url: str, timeout: int = 30) -> str:
    req = Request(url, headers={"User-Agent": "daily-briefs-portal/5.0"})
    with urlopen(req, timeout=timeout) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def fetch(url: str, timeout: int = 30):
    return urlopen(Request(url, headers={"User-Agent": "daily-briefs-portal/5.0"}), timeout=timeout)


def normalize_archive(value: str) -> str:
    return str(value).rstrip("/") + "/"


def is_internal_candidate(url: str, archive: str) -> bool:
    if not url.startswith(archive):
        return False
    if url.rstrip("/") == archive.rstrip("/"):
        return False
    blocked = ("/assets/", "/css/", "/js/", "/tags/", "/categories/", "/feed.xml", "/sitemap.xml", "#")
    return not any(part in url for part in blocked)


def url_is_live(url: str, archive: str) -> bool:
    try:
        with fetch(url, 25) as response:
            final = response.geturl()
            status = getattr(response, "status", 200)
            return status < 400 and final.rstrip("/") != archive.rstrip("/")
    except (HTTPError, URLError, TimeoutError, OSError):
        return False


def title_from_html(html: str) -> str | None:
    match = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
    if not match:
        match = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if not match:
        return None
    text = re.sub(r"<[^>]+>", "", match.group(1))
    return " ".join(text.split()) or None


def discover_from_archive(source: dict, target_date: str) -> dict | None:
    """Use the already-published GitHub Pages archive as the first source of truth.

    This fixes the stale-post problem: if the source site already shows the
    requested day's post, the portal should not keep a stale cloned entry.
    """
    archive = normalize_archive(source["archive"])
    html = fetch_text(archive, 30)
    parser = LinkParser()
    parser.feed(html)

    candidates: list[dict] = []
    for link in parser.links:
        absolute = urljoin(archive, link["href"])
        if not is_internal_candidate(absolute, archive):
            continue

        date_match = DATE_IN_URL.search(absolute) or DATE_ANYWHERE.search(f"{absolute} {link.get('text','')}")
        if not date_match:
            continue
        year, month, day = date_match.groups()
        post_date = f"{year}-{month}-{day}"
        if post_date != target_date:
            continue
        candidates.append({
            "date": post_date,
            "url": absolute,
            "title": link.get("text") or source.get("heading") or source.get("label"),
            "method": "published_archive",
            "source_file": None,
            "archive": archive,
            "error": None,
            "stale": False,
        })

    candidates.sort(key=lambda item: (item["date"], item["url"]), reverse=True)
    for item in candidates[:20]:
        if url_is_live(item["url"], archive):
            return item
    return None


def clone_repo(source: dict, destination: Path) -> None:
    repo = str(source["github_repo"])
    branch = str(source.get("branch", "main"))
    url = f"https://github.com/{repo}.git"
    command = [
        "git", "clone", "--depth", "1", "--single-branch",
        "--branch", branch, "--quiet", url, str(destination),
    ]
    subprocess.run(command, check=True, timeout=120)


def list_posts(repo_dir: Path, source: dict, target_date: str) -> list[dict]:
    posts_dir = repo_dir / str(source.get("posts_dir", "_posts"))
    if not posts_dir.is_dir():
        raise RuntimeError(f"Post directory does not exist: {posts_dir.relative_to(repo_dir)}")

    candidates = []
    for path in posts_dir.iterdir():
        if not path.is_file():
            continue
        match = POST_FILE.match(path.name)
        if not match:
            continue
        year, month, day, slug = match.groups()
        post_date = f"{year}-{month}-{day}"
        if post_date != target_date:
            continue
        candidates.append({"date": post_date, "slug": slug, "path": path})

    candidates.sort(key=lambda item: (item["date"], item["slug"]), reverse=True)
    if not candidates:
        raise RuntimeError(f"No dated Markdown posts found in {posts_dir.relative_to(repo_dir)}")
    return candidates


def permalink_candidates(permalink: str, archive: str) -> list[str]:
    permalink = permalink.strip()
    if permalink.startswith(("http://", "https://")):
        return [permalink]

    parsed = urlparse(archive)
    origin = f"{parsed.scheme}://{parsed.netloc}/"
    archive_path = parsed.path.rstrip("/")
    candidates = []

    if permalink.startswith("/"):
        candidates.append(urljoin(origin, permalink.lstrip("/")))
        if archive_path and not permalink.startswith(archive_path + "/"):
            candidates.append(archive.rstrip("/") + "/" + permalink.lstrip("/"))
    else:
        candidates.append(urljoin(archive, permalink))

    return list(dict.fromkeys(candidates))


def resolve_post(source: dict, candidate: dict) -> dict | None:
    archive = normalize_archive(source["archive"])
    post_date = candidate["date"]
    slug = candidate["slug"]
    content = candidate["path"].read_text(encoding="utf-8", errors="replace")
    title_match = TITLE.search(content)
    permalink_match = PERMALINK.search(content)
    year, month, day = post_date.split("-")

    urls = []
    if permalink_match:
        urls.extend(permalink_candidates(permalink_match.group(1), archive))

    urls.extend([
        f"{archive}{year}/{month}/{day}/{slug}.html",
        f"{archive}{year}/{month}/{day}/{slug}/",
    ])
    urls = list(dict.fromkeys(urls))

    validate = source.get("validate_url", True) is not False
    for url in urls:
        if url.rstrip("/") == archive.rstrip("/"):
            continue
        if not validate or url_is_live(url, archive):
            return {
                "date": post_date,
                "url": url,
                "title": title_match.group(1).strip() if title_match else None,
                "method": "git_clone",
                "source_file": str(candidate["path"].name),
                "archive": archive,
                "error": None,
                "stale": False,
            }
    return None


def discover_from_git(source: dict, target_date: str, temp_root: Path) -> dict | None:
    source_id = str(source["id"])
    repo_dir = temp_root / source_id

    if not repo_dir.exists():
        clone_repo(source, repo_dir)

    posts = list_posts(repo_dir, source, target_date)
    for candidate in posts[:30]:
        result = resolve_post(source, candidate)
        if result:
            return result
    return None


def previous_good_source(previous: dict, source_id: str) -> dict | None:
    item = (previous.get("sources") or {}).get(source_id)
    if isinstance(item, dict) and item.get("url"):
        kept = dict(item)
        kept["stale"] = True
        kept["error"] = "Refresh failed; retained the previous working post."
        return kept
    return None


def static_source_result(source: dict) -> dict:
    url = str(source.get("url") or source.get("archive") or "")
    return {
        "date": None,
        "url": url,
        "title": source.get("heading") or source.get("label"),
        "method": "static",
        "source_file": None,
        "archive": normalize_archive(url) if url else "",
        "error": None if url else "Static URL is missing.",
        "stale": False,
        "static_link": True,
    }


def is_static_source(source: dict) -> bool:
    return source.get("kind") == "static" or source.get("type") == "static" or bool(source.get("url"))


def discover_for_date(source: dict, target_date: str, temp_root: Path) -> tuple[dict | None, list[str]]:
    errors = []
    result = None

    try:
        result = discover_from_archive(source, target_date)
        if result:
            print(f"{source['id']} {target_date}: archive -> {result['url']}")
    except Exception as exc:
        errors.append(f"archive: {type(exc).__name__}: {exc}")

    if not result:
        try:
            result = discover_from_git(source, target_date, temp_root)
            if result:
                print(f"{source['id']} {target_date}: git -> {result['url']}")
        except Exception as exc:
            errors.append(f"git: {type(exc).__name__}: {exc}")

    return result, errors


def main() -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}
    portal = config.get("portal", {})
    timezone = portal.get("timezone", "Asia/Kolkata")
    now = datetime.now(ZoneInfo(timezone))
    today_ist = now.date().isoformat()
    yesterday_ist = (now.date() - timedelta(days=1)).isoformat()

    try:
        previous = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except Exception:
        previous = {}

    CONFIG_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_JSON_PATH.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    output = {"generated_at": now.isoformat(), "sources": {}}

    with tempfile.TemporaryDirectory(prefix="daily-briefs-") as temp:
        temp_root = Path(temp)
        for source in config.get("sources", []):
            if source.get("enabled", True) is False:
                continue

            source_id = str(source["id"])

            if is_static_source(source):
                result = static_source_result(source)
                output["sources"][source_id] = result
                print(f"{source_id}: static -> {result['url']}")
                continue

            today_result, today_errors = discover_for_date(source, today_ist, temp_root)
            yesterday_result, yesterday_errors = discover_for_date(source, yesterday_ist, temp_root)

            if not today_result:
                today_result = {
                    "date": None,
                    "url": None,
                    "title": None,
                    "method": None,
                    "source_file": None,
                    "archive": normalize_archive(source["archive"]),
                    "error": "; ".join(today_errors) or f"No post URL found for {today_ist}.",
                    "stale": False,
                }

            if not yesterday_result:
                yesterday_result = {
                    "date": None,
                    "url": None,
                    "title": None,
                    "method": None,
                    "source_file": None,
                    "archive": normalize_archive(source["archive"]),
                    "error": "; ".join(yesterday_errors) or f"No post URL found for {yesterday_ist}.",
                    "stale": False,
                }

            preferred = today_result if today_result.get("url") else yesterday_result
            output["sources"][source_id] = {
                **preferred,
                "today": today_result,
                "yesterday": yesterday_result,
            }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
