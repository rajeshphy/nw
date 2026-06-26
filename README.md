# Daily Briefs Portal (`/nw`)

Static GitHub Pages portal for displaying the newest available post from multiple news repositories.

## Main configuration

Edit only:

```text
data/portal.yml
```

It controls:

- portal title;
- timezone and date label;
- interface labels;
- button names, subtitles and order;
- source headings;
- enabled/disabled state;
- archive and GitHub repository settings;
- latest badge display mode.

The browser reads `data/portal.yml` directly, so menu and title changes do not depend on Liquid/Jekyll processing.

## Latest badge

The default is:

```yaml
latest_badge_mode: "time"
```

This shows only the workflow fetch time, such as `10:00 PM`, on one line.

Other values:

```yaml
latest_badge_mode: "label_time"  # Latest: 10:00 PM
latest_badge_mode: "label"       # Latest
```

## Add a source

Add another item under `sources:` in `data/portal.yml`. Reorder the blocks to reorder the menu. Set `enabled: false` to hide a source.

## GitHub Pages

Use:

```text
Settings → Pages → Deploy from a branch → main → /(root)
```

The expected URL is:

```text
https://rajeshphy.github.io/nw/
```

## Automatic updates

`.github/workflows/update-portal.yml` runs on schedule and manually. It updates `data/posts.json` and commits it to `main`.

Repository setting:

```text
Settings → Actions → General → Workflow permissions → Read and write permissions
```
