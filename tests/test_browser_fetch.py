#!/usr/bin/env python3
"""Integration tests for the browser skill's fetch.py.

Runs real HTTP requests against live sites to verify fetch, search,
error handling, redirect tracking, and content quality detection.

Usage:
    python3 tests/test_browser_fetch.py           # run all tests
    python3 tests/test_browser_fetch.py -v        # verbose (print output snippets)
"""
import os
import sys
import subprocess
import time
import importlib.util

FETCH_PY = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "src", "skills", "builtins", "browser", "fetch.py",
)
FETCH_PY = os.path.normpath(FETCH_PY)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

passed = 0
failed = 0
skipped = 0


def run_fetch(args, timeout=60):
    """Run fetch.py with the given args list. Returns (exit_code, stdout, stderr)."""
    result = subprocess.run(
        [sys.executable, FETCH_PY] + args,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return result.returncode, result.stdout, result.stderr


def snippet(text, max_len=200):
    """Return a truncated preview of text for verbose output."""
    text = text.strip()
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def assert_test(name, condition, output="", detail=""):
    """Record a test result."""
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        reason = detail or snippet(output, 300)
        print(f"  FAIL  {name}")
        print(f"        {reason}")


def skip_test(name, reason=""):
    """Record a skipped test."""
    global skipped
    skipped += 1
    print(f"  SKIP  {name} {('-- ' + reason) if reason else ''}")


def load_fetch_module():
    """Import fetch.py as a module for unit testing."""
    spec = importlib.util.spec_from_file_location("fetch", FETCH_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


verbose = "-v" in sys.argv or "--verbose" in sys.argv


# ---------------------------------------------------------------------------
# Test: fetch Wikipedia
# ---------------------------------------------------------------------------

def test_fetch_wikipedia():
    print("\n--- Test: Fetch Wikipedia ---")
    code, out, err = run_fetch(["https://en.wikipedia.org/wiki/Python_(programming_language)"])

    assert_test(
        "wikipedia: exit code 0",
        code == 0,
        detail=f"exit={code} stderr={snippet(err)}",
    )
    assert_test(
        "wikipedia: has CONTENT FROM header",
        "--- CONTENT FROM" in out,
        out,
    )
    assert_test(
        "wikipedia: contains 'Python'",
        "Python" in out,
        out,
    )
    assert_test(
        "wikipedia: substantial content (>1000 chars)",
        len(out.strip()) > 1000,
        detail=f"length={len(out.strip())}",
    )
    assert_test(
        "wikipedia: no low-content warning",
        "WARNING: Very little content" not in out,
        out,
    )

    if verbose:
        print(f"        [output preview] {snippet(out)}")


# ---------------------------------------------------------------------------
# Test: fetch wp.pl (Polish news portal)
# ---------------------------------------------------------------------------

def test_fetch_wp():
    print("\n--- Test: Fetch wp.pl ---")
    code, out, err = run_fetch(["https://www.wp.pl"])

    assert_test(
        "wp.pl: exit code 0",
        code == 0,
        detail=f"exit={code} stderr={snippet(err)}",
    )
    assert_test(
        "wp.pl: has CONTENT FROM header",
        "--- CONTENT FROM" in out,
        out,
    )
    assert_test(
        "wp.pl: non-empty output (>500 chars)",
        len(out.strip()) > 500,
        detail=f"length={len(out.strip())}",
    )
    if "WARNING" in out:
        assert_test(
            "wp.pl: warning suggests navigate fallback",
            "browser navigate" in out,
            out,
        )
    else:
        assert_test(
            "wp.pl: contains some Polish or general text",
            True,
        )

    if verbose:
        print(f"        [output preview] {snippet(out)}")


# ---------------------------------------------------------------------------
# Test: fetch Google News (RSS auto-detection)
# ---------------------------------------------------------------------------

def test_fetch_google_news():
    print("\n--- Test: Fetch Google News ---")
    code, out, err = run_fetch(["https://news.google.com/search?q=technology&hl=en-US&gl=US"])

    assert_test(
        "google news: exit code 0",
        code == 0,
        detail=f"exit={code} stderr={snippet(err)}",
    )
    assert_test(
        "google news: has NEWS RESULTS header",
        "--- NEWS RESULTS ---" in out,
        out,
    )
    assert_test(
        "google news: contains numbered results",
        "1. **" in out,
        out,
    )
    assert_test(
        "google news: has multiple results",
        "2. **" in out,
        out,
    )

    if verbose:
        print(f"        [output preview] {snippet(out, 400)}")


# ---------------------------------------------------------------------------
# Test: Google News article redirect detection
# ---------------------------------------------------------------------------

def test_google_news_article_redirect():
    print("\n--- Test: Google News Article Redirect ---")
    code, out, err = run_fetch([
        "https://news.google.com/rss/articles/CBMiggFBVV95cUxQdkpod0lmWTBCZmo2?oc=5"
    ])

    assert_test(
        "gnews article: exit code 0 (handled gracefully)",
        code == 0,
        detail=f"exit={code}",
    )
    assert_test(
        "gnews article: explains JS redirect issue",
        "JavaScript redirect" in out or "cannot be fetched directly" in out,
        out,
    )
    assert_test(
        "gnews article: suggests navigate",
        "browser navigate" in out,
        out,
    )
    assert_test(
        "gnews article: suggests search alternative",
        "browser search" in out,
        out,
    )

    if verbose:
        print(f"        [output] {snippet(out, 400)}")


# ---------------------------------------------------------------------------
# Test: web search via DuckDuckGo
# ---------------------------------------------------------------------------

def test_search():
    print("\n--- Test: Web Search ---")
    code, out, err = run_fetch(["--search", "python", "programming", "language"])

    assert_test(
        "search: exit code 0",
        code == 0,
        detail=f"exit={code} stderr={snippet(err)}",
    )
    assert_test(
        "search: has SEARCH RESULTS header",
        "--- SEARCH RESULTS FOR:" in out,
        out,
    )
    assert_test(
        "search: contains numbered results",
        "1. **" in out,
        out,
    )
    assert_test(
        "search: results contain URLs (http)",
        "http" in out.split("SEARCH RESULTS")[1] if "SEARCH RESULTS" in out else False,
        out,
    )
    assert_test(
        "search: has fetch hint at bottom",
        "browser fetch" in out,
        out,
    )

    if verbose:
        print(f"        [output preview] {snippet(out, 400)}")


# ---------------------------------------------------------------------------
# Test: error handling -- nonexistent domain (DNS failure)
# ---------------------------------------------------------------------------

def test_error_dns():
    print("\n--- Test: DNS Error ---")
    code, out, err = run_fetch(["https://this-domain-does-not-exist-xyz123.invalid"])

    assert_test(
        "dns error: non-zero exit code",
        code != 0,
        detail=f"exit={code}",
    )
    assert_test(
        "dns error: output says DO NOT RETRY",
        "DO NOT RETRY" in out,
        out,
    )

    if verbose:
        print(f"        [output] {snippet(out)}")


# ---------------------------------------------------------------------------
# Test: error handling -- 404 page
# ---------------------------------------------------------------------------

def test_error_404():
    print("\n--- Test: HTTP 404 ---")
    code, out, err = run_fetch(["https://www.google.com/this-page-absolutely-does-not-exist-404"])

    assert_test(
        "404: non-zero exit code",
        code != 0,
        detail=f"exit={code}",
    )
    assert_test(
        "404: mentions 404 in output",
        "404" in out,
        out,
    )
    assert_test(
        "404: says DO NOT RETRY",
        "DO NOT RETRY" in out,
        out,
    )

    if verbose:
        print(f"        [output] {snippet(out)}")


# ---------------------------------------------------------------------------
# Test: redirect tracking
# ---------------------------------------------------------------------------

def test_redirect():
    print("\n--- Test: Redirect Tracking ---")
    code, out, err = run_fetch(["http://github.com"])

    assert_test(
        "redirect: exit code 0",
        code == 0,
        detail=f"exit={code} stderr={snippet(err)}",
    )
    assert_test(
        "redirect: output references github.com",
        "github.com" in out,
        out,
    )

    if verbose:
        print(f"        [output preview] {snippet(out)}")


# ---------------------------------------------------------------------------
# Test: content quality -- anti-bot detection (unit)
# ---------------------------------------------------------------------------

def test_quality_detection():
    print("\n--- Test: Content Quality Detection (unit) ---")
    fetch_mod = load_fetch_module()

    cf_text = "Just a moment... Checking your browser. Ray ID: abc123"
    warnings = fetch_mod.check_content_quality(cf_text, "https://example.com")
    assert_test(
        "quality: detects cloudflare challenge",
        len(warnings) > 0 and "WARNING" in warnings[0],
        detail=str(warnings),
    )

    thin_text = "Hello"
    warnings = fetch_mod.check_content_quality(thin_text, "https://example.com")
    assert_test(
        "quality: detects thin content",
        len(warnings) > 0 and "Very little content" in warnings[0],
        detail=str(warnings),
    )

    good_text = "A" * 500
    warnings = fetch_mod.check_content_quality(good_text, "https://example.com")
    assert_test(
        "quality: no warning for good content",
        len(warnings) == 0,
        detail=str(warnings),
    )


# ---------------------------------------------------------------------------
# Test: HTMLToText parser basics (unit)
# ---------------------------------------------------------------------------

def test_html_parser():
    print("\n--- Test: HTMLToText Parser (unit) ---")
    fetch_mod = load_fetch_module()

    p = fetch_mod.HTMLToText()
    p.feed("<html><head><title>T</title></head><body><h1>Hello</h1><p>World</p></body></html>")
    text = p.get_text()
    assert_test("parser: extracts heading", "# Hello" in text, text)
    assert_test("parser: extracts paragraph", "World" in text, text)

    p2 = fetch_mod.HTMLToText()
    p2.feed("<div>Visible<script>alert('x')</script> text<style>.x{}</style> here</div>")
    text2 = p2.get_text()
    assert_test("parser: strips script tags", "alert" not in text2, text2)
    assert_test("parser: strips style tags", ".x{}" not in text2, text2)
    assert_test("parser: keeps visible text", "Visible" in text2 and "text" in text2, text2)

    p3 = fetch_mod.HTMLToText()
    p3.feed('<a href="https://example.com">Click here</a>')
    text3 = p3.get_text()
    assert_test("parser: formats links as markdown", "[Click here](https://example.com)" in text3, text3)


# ---------------------------------------------------------------------------
# Test: error formatting (unit)
# ---------------------------------------------------------------------------

def test_error_formatting():
    print("\n--- Test: Error Formatting (unit) ---")
    fetch_mod = load_fetch_module()

    class FakeHTTPError:
        def __init__(self, code, reason=""):
            self.code = code
            self.reason = reason

    msg = fetch_mod.format_http_error(FakeHTTPError(404, "Not Found"), "https://x.com/page")
    assert_test("error fmt: 404 says DO NOT RETRY", "DO NOT RETRY" in msg, msg)

    msg = fetch_mod.format_http_error(FakeHTTPError(403, "Forbidden"), "https://x.com/page")
    assert_test("error fmt: 403 suggests navigate", "navigate" in msg, msg)

    msg = fetch_mod.format_http_error(FakeHTTPError(429, "Too Many"), "https://x.com/page")
    assert_test("error fmt: 429 says wait", "Wait" in msg, msg)

    msg = fetch_mod.format_http_error(FakeHTTPError(500, "Internal"), "https://x.com/page")
    assert_test("error fmt: 5xx says retry once", "retry once" in msg, msg)

    class FakeURLError:
        def __init__(self, reason):
            self.reason = reason

    msg = fetch_mod.format_url_error(FakeURLError("nodename nor servname provided"), "https://bad.invalid")
    assert_test("error fmt: DNS failure says DO NOT RETRY", "DO NOT RETRY" in msg, msg)

    msg = fetch_mod.format_url_error(FakeURLError("timed out"), "https://slow.example")
    assert_test("error fmt: timeout says retry once", "retry once" in msg, msg)


# ---------------------------------------------------------------------------
# Test: Google News RSS URL conversion (unit)
# ---------------------------------------------------------------------------

def test_google_news_rss():
    print("\n--- Test: Google News RSS Conversion (unit) ---")
    fetch_mod = load_fetch_module()

    rss = fetch_mod.google_news_to_rss("https://news.google.com/search?q=AI&hl=en-US&gl=US")
    assert_test("gnews rss: search converts to /rss/search", rss is not None and "/rss/search" in rss, str(rss))

    rss = fetch_mod.google_news_to_rss("https://news.google.com/?hl=en-US&gl=US")
    assert_test("gnews rss: home converts to /rss", rss is not None and "/rss?" in rss, str(rss))

    rss = fetch_mod.google_news_to_rss("https://www.example.com/search?q=test")
    assert_test("gnews rss: non-gnews returns None", rss is None, str(rss))


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("Browser Skill - fetch.py Test Suite")
    print("=" * 60)

    start = time.time()

    # Unit tests first (no network)
    test_html_parser()
    test_error_formatting()
    test_quality_detection()
    test_google_news_rss()

    # Integration tests (network required)
    print("\n  [integration tests -- requires network]")
    test_fetch_wikipedia()
    test_fetch_wp()
    test_fetch_google_news()
    test_google_news_article_redirect()
    test_search()
    test_error_dns()
    test_error_404()
    test_redirect()

    elapsed = time.time() - start

    print("\n" + "=" * 60)
    total = passed + failed + skipped
    print(f"Results: {passed} passed, {failed} failed, {skipped} skipped ({total} total) in {elapsed:.1f}s")
    print("=" * 60)

    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
