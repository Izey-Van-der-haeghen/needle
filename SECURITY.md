# Security

## Reporting a problem

Please report security problems privately, by email to **hello@izey.dev**, not in a public issue. Include what you found, how to reproduce it and which version of Needle you used (Settings, at the top).

You'll get an answer within a week. Once a fix is out, you're welcome to publish your findings; tell me if you'd like to be credited.

## What counts

Anything that lets a web page or another extension:

- read or change Needle's stored data, including API keys;
- make Needle's background worker do something for it;
- run script in Needle's pages through page data (titles, links, structured data and so on);
- make Needle send data to a service the user didn't start a check for.

Problems in the third-party services Needle can call (Google, Microsoft Bing, DataForSEO) belong with those services.

## Supported versions

Only the latest version, as published in the Chrome Web Store and on the `main` branch, gets security fixes.
