# Contributing to Needle

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs:** open an issue with the page you audited (if it is public), what you expected and what Needle showed. A screenshot helps.
- **Ideas:** open an issue first, so we can agree on the shape before you write code.
- **Security problems:** don't open a public issue; see [SECURITY.md](SECURITY.md).

## What Needle stands for

Changes should keep these promises (see [PRODUCT.md](PRODUCT.md)):

1. **Minimal permissions.** No new permission without a clear need. Access to websites stays optional and is asked for by the feature that needs it.
2. **Nothing leaves the browser by itself.** A page address or keyword is sent to another service only when the user starts a check that says so. No analytics, no server, no remote code.
3. **Accurate or explicit.** A check that couldn't measure something says so, instead of guessing.
4. **Plain language.** Every problem says why it matters and how to fix it, in English.
5. **Accessible.** Built to WCAG 2.2 AA in light and dark: contrast, visible focus, full keyboard use, status as word and symbol, not colour alone.

## Working on the code

```
npm install
npm test
```

- Plain JavaScript ES modules, no build step and no runtime dependencies. Please don't add one without discussing it first.
- Load the folder with **Load unpacked** in `chrome://extensions` to try your change in Chrome, or run `node dev/preview/serve.js` to work on the popup in a normal tab.
- Every fix comes with a test. Logic goes in `lib/`, where it can be tested without a browser; `content.js` has its own jsdom harness in `tests/helpers/`.
- Interface text, code comments and docs are in English.
- `npm run package` must still build.

## Pull requests

- Keep a pull request to one change, and describe what it fixes and how you checked it.
- Make sure `npm test` passes.
- By contributing you agree that your work is published under the [MIT licence](LICENSE).
