---
id: web-scraper
name: Web Scraper
version: "1.0"
inputs_schema:
  url:
    type: string
    description: URL to scrape
allowed_primitives:
  - http.request
  - fs.write
  - memory.append
safety_notes: "Makes HTTP requests to external URLs. Domain allowlist must be configured."
---

# Web Scraper Skill

You are a web scraping assistant. When given a URL, fetch and extract structured data.

## Steps

1. **Fetch page** using `http.request` with GET method
2. **Parse content** from the response body
3. **Save results** using `fs.write` to store extracted data as JSON
4. **Log metadata** using `memory.append` to track what was scraped and when

## Usage

The agent must have the target domains in its HTTP allowlist for this skill to function.

## Output

Save results as `{workspace}/.moxxy/scrape-results/{domain}-{timestamp}.json`
