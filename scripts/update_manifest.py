#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime
import json
import re
import shutil
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
PERMALINK = re.compile(r"^permalink:\s*[\"']?([^\"'\n]+)", re.M)
TITLE = re.compile(r"^title:\s*[\"']?(.+?)[\"']?\s*$", re.M)


def fetch(url: str, timeout: int = 30):
    return urlopen(Request(url, headers={"User-Agent": "daily-briefs-portal/4.0"}), timeout=timeout)


def url_is_live(url: str, archive: str) -> bool:
    try:
        with fetch(url, 25) as response:
            final = response.geturl()
            status = getattr(response, "status", 200)
            return status < 400 and final.rstrip("/") != archive.rstrip("/")
    except (HTTPError, URLError, TimeoutError, OSError):
        return False


def clone_repo(source: dict, destination: Path) -> None:
    repo = str(source["github_repo"])
    branch = str(source.get("branch", "main"))
    url = f"https://github.com/{repo}.git"
    command = [
        "git", "clone", "--depth", "1", "--single-branch",
        "--branch", branch, "--quiet", url, str(destination),
    ]
    subprocess.run(command, check=True, timeout=120)


def list_posts(repo_dir: Path, source: dict, today_ist: str) -> list[dict]:
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
        if post_date > today_ist:
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
    archive = str(source["archive"]).rstrip("/") + "/"
    post_date = candidate["date"]
    slug = candidate["slug"]
    content = candidate["path"].read_text(encoding="utf-8", errors="replace")
    title_match = TITLE.search(content)
    permalink_match = PERMALINK.search(content)
    year, month, day = post_date.split("-")

    urls = []
    if permalink_match:
        urls.extend(permalink_candidates(permalink_match.group(1), archive))

    # Jekyll's default post URL with no custom permalink in the source projects.
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


def previous_good_source(previous: dict, source_id: str) -> dict | None:
    item = (previous.get("sources") or {}).get(source_id)
    if isinstance(item, dict) and item.get("url"):
        kept = dict(item)
        kept["stale"] = True
        kept["error"] = "Refresh failed; retained the last known working post."
        return kept
    return None


def main() -> None:
    config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}
    portal = config.get("portal", {})
    timezone = portal.get("timezone", "Asia/Kolkata")
    now = datetime.now(ZoneInfo(timezone))
    today_ist = now.date().isoformat()

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
            archive = str(source["archive"]).rstrip("/") + "/"
            repo_dir = temp_root / source_id
            try:
                clone_repo(source, repo_dir)
                posts = list_posts(repo_dir, source, today_ist)
                result = None
                for candidate in posts[:30]:
                    result = resolve_post(source, candidate)
                    if result:
                        break
                if not result:
                    raise RuntimeError("No live individual post URL found among the 30 newest posts")
                output["sources"][source_id] = result
                print(f"{source_id}: {result['date']} -> {result['url']}")
            except Exception as exc:
                retained = previous_good_source(previous, source_id)
                if retained:
                    output["sources"][source_id] = retained
                    print(f"{source_id}: retained previous URL after {type(exc).__name__}: {exc}")
                else:
                    output["sources"][source_id] = {
                        "date": None,
                        "url": None,
                        "title": None,
                        "method": None,
                        "source_file": None,
                        "archive": archive,
                        "error": f"{type(exc).__name__}: {exc}",
                        "stale": False,
                    }
                    print(f"{source_id}: ERROR: {type(exc).__name__}: {exc}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
