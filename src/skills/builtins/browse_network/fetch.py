#!/usr/bin/env python3
"""Lightweight web page fetcher using only Python stdlib."""
import sys
import re
import ssl
import gzip
import urllib.request
import urllib.error
from html.parser import HTMLParser


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
        if tag == "strong" or tag == "b":
            self.result.append("**")
        if tag == "em" or tag == "i":
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
        if tag == "strong" or tag == "b":
            self.result.append("**")
        if tag == "em" or tag == "i":
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


def fetch_url(url):
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

    req = urllib.request.Request(url, headers=headers)

    with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        charset = resp.headers.get_content_charset() or "utf-8"
        return raw.decode(charset, errors="replace")


def main():
    if len(sys.argv) < 2:
        print("Usage: browse_network <URL>")
        sys.exit(1)

    url = sys.argv[1]
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    try:
        html = fetch_url(url)
        parser = HTMLToText()
        parser.feed(html)
        text = parser.get_text()

        if not text.strip():
            print(f"Warning: No readable content extracted from {url}")
            print("The page may require JavaScript to render content.")
            sys.exit(0)

        print(f"--- CONTENT FROM {url} ---\n")

        limit = 15000
        if len(text) > limit:
            print(text[:limit])
            print("\n\n... [TRUNCATED - PAGE TOO LONG] ...")
        else:
            print(text)

    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.reason} for {url}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"URL Error: {e.reason} for {url}")
        sys.exit(1)
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
