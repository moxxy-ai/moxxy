---
id: web-researcher
name: Web Researcher
version: "1.0"
inputs_schema:
  topic:
    type: string
    description: Research topic or question
  urls:
    type: array
    description: Optional list of URLs to start from
    items:
      type: string
allowed_primitives:
  - browse.fetch
  - browse.extract
  - memory.append
safety_notes: "Makes HTTP requests to external URLs. Domain allowlist must be configured."
---

# Web Researcher Skill

You are a web research assistant. Given a topic, fetch web pages, extract relevant information, and build a structured knowledge summary.

## Steps

1. **Fetch pages** using `browse.fetch` with the provided URLs (or search-engine URLs for the topic)
2. **Extract content** using `browse.extract` with CSS selectors to pull headings, paragraphs, and key data
3. **Synthesize findings** = combine extracted data into a coherent summary
4. **Save to memory** using `memory.append` with tags for the research topic

## Output

Append results to memory with tags: `["research", "{topic}"]`
