# Preview harness

Opens Needle's real popup and settings page in a normal browser tab, without installing the extension. A stub of the `chrome.*` APIs (`chrome-stub.js`) answers with data from a fictional demo page, so nothing is fetched from real sites.

```
node dev/preview/serve.js
```

Then open http://localhost:5178/popup.html (add `?theme=dark`, `?access=1` for granted site access, `?panel=1` for side-panel mode, `?welcome=1` for the first-run note, `?whatsnew=1` for the note after an update). Open it at 560 px wide to match the popup.

## Demo data

`demo-site/` holds a fictional page (Riverside Bikes does not exist), its robots.txt and sitemap. `fixtures/riverside.json` is built from it by running the real `content.js` in jsdom:

```
npx vite-node dev/preview/build-fixture.mjs
```

PageSpeed and DataForSEO are never faked: in the preview they answer as the real extension does without an API key or login.

## Store images

With the server running:

```
node dev/preview/shots.mjs
```

writes five 1280 × 800 screenshots to `store/screenshots/` and the 440 × 280 promo tile to `store/promo-440x280.png`, using headless Chrome (`CHROME_PATH` to override). `node dev/preview/shots.mjs --promo` renders only the promo tile.
