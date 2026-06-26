# Daily Briefs Portal

A lightweight GitHub Pages portal that displays the current IST-day post from five existing Jekyll news sites:

- PIB: `https://rajeshphy.github.io/pib/`
- DMK: `https://rajeshphy.github.io/dumka-jhar-news/`
- POL: `https://rajeshphy.github.io/political-news/`
- ECO: `https://rajeshphy.github.io/economic-news/`
- PHY: `https://rajeshphy.github.io/physics-news/`

## How the date is fetched

On every page load or menu selection, `assets/js/portal.js`:

1. calculates the current date in `Asia/Kolkata`;
2. fetches the selected source site's archive homepage;
3. parses its dated post links;
4. displays today's post in the portal;
5. falls back to the newest available dated post when today's workflow has not run yet.

The portal discovers URLs from the archive, so filenames do not need to match across projects.

## Deployment

1. Create a public GitHub repository, preferably named `news`.
2. Upload the contents of this ZIP to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main` and folder `/ (root)`, then save.
6. The expected URL will be `https://rajeshphy.github.io/news/`.

No GitHub Action, API key, AI call, or daily cron job is needed for this portal.

## Changing the repository name

The site is plain static HTML and works under any repository path. `_config.yml` currently records `/news` for documentation, but the runtime code uses relative portal assets and absolute source paths.

## Files

- `index.html` — portal structure and menu
- `assets/css/portal.css` — responsive visual design
- `assets/js/portal.js` — IST date selection and source archive parsing
- `404.html` — fallback page
- `.nojekyll` — serves the files directly without a Jekyll build
