# AICW Visibility

Website AI visibility checker for AI crawlers, answer engines, and public datasets.

```bash
npx aicw-visibility example.com
```

Or install globally:

```bash
npm install -g aicw-visibility
aicw-visibility example.com
```

## Features

- Checks `robots.txt`, sitemap, `llms.txt`, headers, meta tags, JSON-LD, and HTML structure.
- Tests visibility to AI bots across training, search indexing, and user interaction crawlers.
- Checks URL/domain presence in Common Crawl and selected public web sources.
- Uses Puppeteer by default for JavaScript-rendered content comparison.
- Writes a local HTML report plus timestamped JSON data.

If Puppeteer's browser is missing locally:

```bash
npx puppeteer browsers install chrome
```

To skip browser rendering checks:

```bash
aicw-visibility example.com --no-browser
```

## Screenshots

![CLI overview](docs/imgs/cli-overview.png)

![JavaScript rendering check](docs/imgs/cli-js-rendering.png)

![HTML report](docs/imgs/html-report.png)

## Video Demo

https://github.com/user-attachments/assets/8b5c2a43-4508-4fcb-9106-c6305c1200f7

## License

See [LICENSE](LICENSE).
