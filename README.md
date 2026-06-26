# Daily Briefs Portal

YAML-controlled GitHub Pages portal for the newest available individual post from each news repository.

## Portal address

This repository is configured for:

```text
https://rajeshphy.github.io/nw/
```

The Jekyll `baseurl` is `/nw`.

## Deployment

1. Upload all files to the root of a public repository named `nw`.
2. Open **Actions → Update portal links → Run workflow** once.
3. Confirm that `data/posts.json` contains a non-empty `url` for every enabled source.
4. Enable GitHub Pages from the `main` branch and root folder.

The updater now clones each public source repository with Git instead of querying the GitHub Contents API. This avoids cross-repository `GITHUB_TOKEN` restrictions and API-rate problems.

## Add, remove or reorder menu buttons

Edit `_data/portal.yml` only.

```yaml
- id: "edu"
  enabled: true
  label: "EDU"
  subtitle: "Education"
  heading: "Education Brief"
  archive: "https://rajeshphy.github.io/education-news/"
  github_repo: "rajeshphy/education-news"
  posts_dir: "docs/_posts"
  branch: "main"
```

Set `enabled: false` to hide a source, move its YAML block to reorder it, or remove the block to delete it.

## Fallback behaviour

The workflow checks up to the newest 30 Markdown posts. If today's page is unavailable, it displays the newest older live page. If a temporary refresh fails, it retains the last known working URL instead of making the portal blank.

## Local test

```bash
pip install -r requirements.txt
python3 scripts/update_manifest.py
bundle exec jekyll serve --baseurl /nw
```

## Important deployment note

This release is deliberately static and includes `.nojekyll`. The browser reads `data/config.json`, which is generated from `_data/portal.yml` by the workflow. Therefore Liquid tags are not used and cannot appear as raw text on GitHub Pages.
