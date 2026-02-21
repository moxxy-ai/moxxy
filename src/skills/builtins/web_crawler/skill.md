# Web Crawler Skill

Use this skill to autonomously browse the internet and extract information from web pages.
It uses a headless browser to load JavaScript-heavy sites (like SPAs) and bypass basic bot-protection effectively.

## Usage
Provide the exact URL you want to crawl as the first argument.

```bash
web_crawler "https://en.wikipedia.org/wiki/Artificial_intelligence"
```

The crawler will return the raw text converted into Markdown format for easy readability. It is hard-capped to ~12,000 characters to protect your context window from overflowing on massive sites.
