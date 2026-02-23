#!/usr/bin/env python3
"""Lightweight web page fetcher with web search and smart error handling."""
import sys
import re
import ssl
import gzip
import urllib.request
import urllib.error
import urllib.parse
from html.parser import HTMLParser

try:
    from socket import timeout as socket_timeout
except ImportError:
    socket_timeout = OSError


class HTMLToText(HTMLParser):
    """Convert HTML to readable Markdown-ish text."""

    BLOCK_TAGS = {
        "p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6",
        "li", "tr", "blockquote", "pre", "section", "article",
        "header", "footer", "dd", "dt", "figcaption", "table",
    }
    SKIP_TAGS = {"script", "style", "noscript", "svg", "head", "template"}
    HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self):
        super().__init__()
        self.result = []
        self.skip_depth = 0
        self.current_link = None
        self.link_text = []
        self.in_pre = False

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return

        if tag in self.BLOCK_TAGS:
            self.result.append("\n")
        if tag in self.HEADING_TAGS:
            level = int(tag[1])
            self.result.append("\n" + "#" * level + " ")
        if tag == "a":
            attrs_dict = dict(attrs)
            href = attrs_dict.get("href", "")
            if href and not href.startswith("#") and not href.startswith("javascript:"):
                self.current_link = href
                self.link_text = []
        if tag == "li":
            self.result.append("\n- ")
        if tag == "br":
            self.result.append("\n")
        if tag == "pre":
            self.in_pre = True
            self.result.append("\n```\n")
        if tag == "code" and not self.in_pre:
            self.result.append("`")
        if tag in ("strong", "b"):
            self.result.append("**")
        if tag in ("em", "i"):
            self.result.append("*")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth -= 1
            return
        if self.skip_depth:
            return

        if tag == "a" and self.current_link is not None:
            text = "".join(self.link_text).strip()
            if text:
                self.result.append(f"[{text}]({self.current_link})")
            self.current_link = None
            self.link_text = []
        if tag in self.BLOCK_TAGS:
            self.result.append("\n")
        if tag == "pre":
            self.in_pre = False
            self.result.append("\n```\n")
        if tag == "code" and not self.in_pre:
            self.result.append("`")
        if tag in ("strong", "b"):
            self.result.append("**")
        if tag in ("em", "i"):
            self.result.append("*")

    def handle_data(self, data):
        if self.skip_depth:
            return
        if self.current_link is not None:
            self.link_text.append(data)
        else:
            if not self.in_pre:
                data = re.sub(r"\s+", " ", data)
            self.result.append(data)

    def get_text(self):
        text = "".join(self.result)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


# ---------------------------------------------------------------------------
# HTTP fetching
# ---------------------------------------------------------------------------

def fetch_url(url):
    """Fetch a URL and return (html_text, final_url) tuple tracking redirects."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip",
    }

    req = urllib.request.Request(url, headers=headers)

    with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
        final_url = resp.url
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        charset = resp.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace"), final_url


def format_http_error(e, url):
    """Return a user-friendly error message for HTTP errors."""
    code = e.code
    if code in (404, 410):
        return f"HTTP {code}: Page not found at {url}\nDO NOT RETRY -- this page does not exist. Check the URL for typos."
    elif code == 403:
        return f"HTTP 403: Access forbidden at {url}\nThe server blocked this request. Try: browser navigate {url}"
    elif code == 429:
        return f"HTTP 429: Rate limited at {url}\nWait before retrying this URL."
    elif 500 <= code < 600:
        return f"HTTP {code}: Server error at {url}\nThis may be temporary -- you can retry once."
    else:
        return f"HTTP {code}: {e.reason} for {url}"


def format_url_error(e, url):
    """Return a user-friendly error message for URL/network errors."""
    reason = str(e.reason)
    if "Name or service not known" in reason or "nodename nor servname" in reason or "getaddrinfo" in reason:
        return f"DNS resolution failed for {url}\nDO NOT RETRY -- the domain does not exist. Check the URL."
    elif "timed out" in reason or "timeout" in reason.lower():
        return f"Connection timed out for {url}\nYou can retry once."
    elif "Connection refused" in reason:
        return f"Connection refused by {url}\nThe server is not accepting connections."
    elif "certificate" in reason.lower() or "ssl" in reason.lower():
        return f"SSL/TLS error for {url}: {reason}"
    else:
        return f"Network error for {url}: {reason}"


# ---------------------------------------------------------------------------
# Content quality detection
# ---------------------------------------------------------------------------

def check_content_quality(text, url):
    """Detect anti-bot pages, thin content, etc. Returns list of warning strings."""
    warnings = []
    text_lower = text.lower()

    antibot_markers = [
        ("enable javascript", "This page requires JavaScript to render."),
        ("please enable cookies", "This page requires cookies."),
        ("checking your browser", "Cloudflare or similar anti-bot protection detected."),
        ("just a moment", "Anti-bot challenge page detected."),
        ("ray id", "Cloudflare protection page detected."),
        ("captcha", "CAPTCHA challenge detected."),
        ("access denied", "Access was denied by the server."),
    ]
    for marker, msg in antibot_markers:
        if marker in text_lower and len(text) < 2000:
            warnings.append(f"WARNING: {msg} Try: browser navigate {url}")
            break

    if len(text.strip()) < 200 and not warnings:
        warnings.append(
            f"WARNING: Very little content extracted ({len(text.strip())} chars). "
            f"The page may require JavaScript. Try: browser navigate {url}"
        )

    return warnings


# ---------------------------------------------------------------------------
# Web search via DuckDuckGo HTML
# ---------------------------------------------------------------------------

def search_web(query):
    """Search the web using DuckDuckGo HTML and return formatted results."""
    encoded = urllib.parse.urlencode({"q": query})
    search_url = f"https://html.duckduckgo.com/html/?{encoded}"

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip",
    }

    req = urllib.request.Request(search_url, headers=headers)
    with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        charset = resp.headers.get_content_charset() or "utf-8"
        html = raw.decode(charset, errors="replace")

    results = []

    # Result links: <a class="result__a" href="...">title</a>
    for m in re.finditer(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        html, re.DOTALL
    ):
        link = m.group(1)
        title = re.sub(r'<[^>]+>', '', m.group(2)).strip()

        # DuckDuckGo wraps links in a redirect -- extract actual URL
        if "uddg=" in link:
            actual = re.search(r'uddg=([^&]+)', link)
            if actual:
                link = urllib.parse.unquote(actual.group(1))

        if title and link.startswith("http"):
            results.append({"title": title, "link": link})

    # Try to get snippets
    snippets = []
    for m in re.finditer(
        r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
        html, re.DOTALL
    ):
        snippet = re.sub(r'<[^>]+>', '', m.group(1)).strip()
        snippets.append(snippet)

    if not results:
        return f"No search results found for: {query}\nTry different search terms."

    lines = [f"--- SEARCH RESULTS FOR: {query} ---\n"]
    for i, r in enumerate(results[:10], 1):
        entry = f"{i}. **{r['title']}**\n   {r['link']}"
        if i - 1 < len(snippets) and snippets[i - 1]:
            entry += f"\n   {snippets[i - 1]}"
        lines.append(entry)

    lines.append("\nUse `browser fetch <url>` to read any of these pages.")
    return "\n\n".join(lines)


# ---------------------------------------------------------------------------
# Google News RSS (kept from original)
# ---------------------------------------------------------------------------

def google_news_to_rss(url):
    """Convert a Google News HTML URL to its RSS equivalent."""
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""
    if "news.google.com" not in host:
        return None

    path = parsed.path
    qs = urllib.parse.parse_qs(parsed.query)
    hl = qs.get("hl", ["en-US"])[0]
    gl = qs.get("gl", ["US"])[0]
    ceid = qs.get("ceid", [f"{gl}:{hl.split('-')[0]}"])[0]

    if path.startswith("/search"):
        q = qs.get("q", [""])[0]
        rss_url = (
            f"https://news.google.com/rss/search?"
            f"{urllib.parse.urlencode({'q': q, 'hl': hl, 'gl': gl, 'ceid': ceid})}"
        )
        return rss_url
    if path.startswith("/topics"):
        return f"https://news.google.com/rss{path}?{urllib.parse.urlencode({'hl': hl, 'gl': gl, 'ceid': ceid})}"
    if path in ("/", ""):
        return f"https://news.google.com/rss?{urllib.parse.urlencode({'hl': hl, 'gl': gl, 'ceid': ceid})}"
    return None


def parse_rss(xml_text):
    """Parse RSS XML and return formatted text with article titles, sources, and dates."""
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml_text)
    items = root.findall(".//item")
    if not items:
        return None

    lines = []
    for i, item in enumerate(items, 1):
        title = item.findtext("title", "").strip()
        link = item.findtext("link", "").strip()
        pub_date = item.findtext("pubDate", "").strip()
        source = item.findtext("source", "").strip()
        desc_html = item.findtext("description", "").strip()

        sub_articles = []
        if desc_html:
            for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>([^<]+)</a>', desc_html):
                sub_url, sub_title = m.group(1), m.group(2).strip()
                if sub_title and sub_title != title:
                    sub_articles.append(f"  - {sub_title}")

        entry = f"{i}. **{title}**"
        if source:
            entry += f" — {source}"
        if pub_date:
            entry += f" ({pub_date})"
        if link:
            entry += f"\n   {link}"
        lines.append(entry)
        if sub_articles:
            lines.extend(sub_articles[:3])

    return "\n\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Handle --search mode
    if len(sys.argv) >= 3 and sys.argv[1] == "--search":
        query = " ".join(sys.argv[2:])
        try:
            result = search_web(query)
            limit = 15000
            if len(result) > limit:
                print(result[:limit])
                print("\n\n... [TRUNCATED] ...")
            else:
                print(result)
        except urllib.error.HTTPError as e:
            print(format_http_error(e, f"DuckDuckGo search for: {query}"))
            sys.exit(1)
        except urllib.error.URLError as e:
            print(format_url_error(e, "https://html.duckduckgo.com"))
            sys.exit(1)
        except Exception as e:
            print(f"Search error: {e}")
            sys.exit(1)
        sys.exit(0)

    # Handle fetch mode
    if len(sys.argv) < 2:
        print("Usage: fetch.py <URL> | fetch.py --search <query>")
        sys.exit(1)

    url = sys.argv[1]
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    try:
        # Google News article redirect URLs require JavaScript to resolve.
        # Give the agent clear guidance instead of returning empty content.
        parsed_url = urllib.parse.urlparse(url)
        if ("news.google.com" in (parsed_url.hostname or "")
                and "/articles/" in parsed_url.path):
            print(f"Google News article links (news.google.com/rss/articles/...) "
                  f"are JavaScript redirects that cannot be fetched directly.\n\n"
                  f"To read this article, try one of these approaches:\n"
                  f"1. Use `browser navigate {url}` to follow the JS redirect and read the page\n"
                  f"2. Search for the article title directly: `browser search \"<article title>\"`\n"
                  f"   then `browser fetch <direct-url>` on the result")
            sys.exit(0)

        # Auto-detect Google News and use RSS feed
        rss_url = google_news_to_rss(url)
        if rss_url:
            xml_text, _ = fetch_url(rss_url)
            rss_result = parse_rss(xml_text)
            if rss_result:
                print("--- NEWS RESULTS ---\n")
                limit = 15000
                if len(rss_result) > limit:
                    print(rss_result[:limit])
                    print("\n\n... [TRUNCATED] ...")
                else:
                    print(rss_result)
                sys.exit(0)

        html, final_url = fetch_url(url)

        # Note redirects
        redirect_note = ""
        if final_url and final_url != url:
            redirect_note = f"(Redirected to: {final_url})\n"

        # Check if response is RSS/Atom XML
        stripped = html.lstrip()
        if stripped.startswith("<?xml") or stripped.startswith("<rss") or stripped.startswith("<feed"):
            rss_result = parse_rss(html)
            if rss_result:
                print(f"--- FEED FROM {final_url or url} ---\n")
                if redirect_note:
                    print(redirect_note)
                print(rss_result)
                sys.exit(0)

        # Convert HTML to text
        parser = HTMLToText()
        parser.feed(html)
        text = parser.get_text()

        if not text.strip():
            print(f"Warning: No readable content extracted from {url}")
            print(f"The page may require JavaScript -- try: browser navigate {url}")
            sys.exit(0)

        # Check content quality
        warnings = check_content_quality(text, url)

        print(f"--- CONTENT FROM {final_url or url} ---\n")
        if redirect_note:
            print(redirect_note)

        limit = 15000
        if len(text) > limit:
            print(text[:limit])
            print("\n\n... [TRUNCATED - PAGE TOO LONG] ...")
        else:
            print(text)

        if warnings:
            print("\n---")
            for w in warnings:
                print(w)

    except urllib.error.HTTPError as e:
        print(format_http_error(e, url))
        sys.exit(1)
    except urllib.error.URLError as e:
        print(format_url_error(e, url))
        sys.exit(1)
    except socket_timeout:
        print(f"Connection timed out for {url}\nYou can retry once.")
        sys.exit(1)
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
