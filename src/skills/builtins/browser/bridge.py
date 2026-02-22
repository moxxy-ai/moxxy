#!/usr/bin/env python3
"""
Persistent browser bridge server for moxxy browser skill.
Manages a Chromium instance via Playwright and accepts commands over HTTP.
Auto-shuts down after 30 minutes of inactivity.
"""
import argparse
import asyncio
import json
import os
import signal
import sys
import tempfile
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

from playwright.async_api import async_playwright

# Globals
browser_instance = None
playwright_instance = None
pages = {}  # tab_id -> page
current_tab = None
snapshot_refs = {}  # ref_number -> locator info
last_activity = time.time()
event_loop = None
IDLE_TIMEOUT = 1800  # 30 minutes


def reset_idle():
    global last_activity
    last_activity = time.time()


async def ensure_browser():
    """Launch browser if not already running."""
    global browser_instance, playwright_instance
    if browser_instance is None or not browser_instance.is_connected():
        if playwright_instance is None:
            playwright_instance = await async_playwright().start()
        browser_instance = await playwright_instance.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ],
        )
    return browser_instance


async def get_current_page():
    """Get or create the current page."""
    global current_tab, pages
    browser = await ensure_browser()
    if current_tab is None or current_tab not in pages:
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page = await context.new_page()
        tab_id = id(page)
        pages[tab_id] = page
        current_tab = tab_id
    return pages[current_tab]


def build_snapshot_text(node, refs, depth=0):
    """Recursively build text snapshot from accessibility tree."""
    if node is None:
        return ""

    lines = []
    role = node.get("role", "")
    name = node.get("name", "")
    value = node.get("value", "")

    # Skip generic/redundant nodes
    skip_roles = {"none", "generic", "presentation"}
    show_node = role not in skip_roles and (name or value)

    if show_node:
        ref = len(refs) + 1
        refs[ref] = {
            "role": role,
            "name": name,
        }
        indent = "  " * depth
        parts = [f"[{ref}] {role}"]
        if name:
            parts.append(f'"{name}"')
        if value:
            parts.append(f"value=\"{value}\"")
        lines.append(f"{indent}{' '.join(parts)}")

    children = node.get("children", [])
    for child in children:
        child_text = build_snapshot_text(child, refs, depth + (1 if show_node else 0))
        if child_text:
            lines.append(child_text)

    return "\n".join(lines)


async def take_snapshot(page):
    """Take accessibility snapshot and return numbered text."""
    global snapshot_refs
    snapshot_refs = {}
    try:
        tree = await page.accessibility.snapshot()
        if tree is None:
            return "(empty page -- no accessibility tree)"
        text = build_snapshot_text(tree, snapshot_refs)
        url = page.url
        title = await page.title()
        header = f"Page: {title}\nURL: {url}\n---\n"
        return header + (text if text else "(no interactive elements found)")
    except Exception as e:
        return f"Error taking snapshot: {e}"


async def find_element_by_ref(page, ref):
    """Find a page element by snapshot ref number."""
    if ref not in snapshot_refs:
        return None, f"Ref [{ref}] not found. Take a new snapshot first."

    info = snapshot_refs[ref]
    role = info["role"]
    name = info["name"]

    try:
        locator = page.get_by_role(role, name=name, exact=False)
        count = await locator.count()
        if count == 0:
            return None, f"Element [{ref}] ({role} \"{name}\") no longer found on page."
        if count > 1:
            # Try exact match
            exact_locator = page.get_by_role(role, name=name, exact=True)
            exact_count = await exact_locator.count()
            if exact_count == 1:
                locator = exact_locator
            else:
                locator = locator.first
        return locator, None
    except Exception as e:
        return None, f"Error finding element [{ref}]: {e}"


async def handle_action(action, args):
    """Execute a browser action and return result."""
    reset_idle()

    if action == "navigate":
        if not args:
            return {"success": False, "error": "navigate requires a URL"}
        url = args[0]
        if not url.startswith("http://") and not url.startswith("https://"):
            url = "https://" + url
        page = await get_current_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            # Give JS a moment to render
            await page.wait_for_timeout(1000)
        except Exception as e:
            return {"success": False, "error": f"Navigation failed: {e}"}
        snapshot = await take_snapshot(page)
        return {"success": True, "result": snapshot}

    elif action == "snapshot":
        page = await get_current_page()
        snapshot = await take_snapshot(page)
        return {"success": True, "result": snapshot}

    elif action == "click":
        if not args:
            return {"success": False, "error": "click requires a ref number"}
        try:
            ref = int(args[0])
        except ValueError:
            return {"success": False, "error": f"Invalid ref: {args[0]}"}
        page = await get_current_page()
        locator, err = await find_element_by_ref(page, ref)
        if err:
            return {"success": False, "error": err}
        try:
            await locator.click(timeout=5000)
            await page.wait_for_timeout(500)
            snapshot = await take_snapshot(page)
            return {"success": True, "result": f"Clicked [{ref}].\n\n{snapshot}"}
        except Exception as e:
            return {"success": False, "error": f"Click failed: {e}"}

    elif action == "type":
        if len(args) < 2:
            return {"success": False, "error": "type requires ref and text"}
        try:
            ref = int(args[0])
        except ValueError:
            return {"success": False, "error": f"Invalid ref: {args[0]}"}
        text = args[1]
        page = await get_current_page()
        locator, err = await find_element_by_ref(page, ref)
        if err:
            return {"success": False, "error": err}
        try:
            await locator.fill(text, timeout=5000)
            return {"success": True, "result": f"Typed \"{text}\" into [{ref}]."}
        except Exception as e:
            # Fallback: try pressing keys one by one
            try:
                await locator.click(timeout=3000)
                await page.keyboard.type(text)
                return {"success": True, "result": f"Typed \"{text}\" into [{ref}] (via keyboard)."}
            except Exception as e2:
                return {"success": False, "error": f"Type failed: {e2}"}

    elif action == "screenshot":
        page = await get_current_page()
        try:
            tmp = tempfile.mktemp(suffix=".png", prefix="moxxy_screenshot_")
            await page.screenshot(path=tmp, full_page=False)
            return {"success": True, "result": f"Screenshot saved to: {tmp}"}
        except Exception as e:
            return {"success": False, "error": f"Screenshot failed: {e}"}

    elif action == "scroll":
        direction = args[0] if args else "down"
        page = await get_current_page()
        try:
            if direction == "down":
                await page.evaluate("window.scrollBy(0, window.innerHeight)")
            elif direction == "up":
                await page.evaluate("window.scrollBy(0, -window.innerHeight)")
            elif direction == "top":
                await page.evaluate("window.scrollTo(0, 0)")
            elif direction == "bottom":
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            else:
                # Try as ref number -- scroll element into view
                try:
                    ref = int(direction)
                    locator, err = await find_element_by_ref(page, ref)
                    if err:
                        return {"success": False, "error": err}
                    await locator.scroll_into_view_if_needed(timeout=5000)
                except ValueError:
                    return {"success": False, "error": f"Unknown scroll direction: {direction}"}
            await page.wait_for_timeout(300)
            snapshot = await take_snapshot(page)
            return {"success": True, "result": f"Scrolled {direction}.\n\n{snapshot}"}
        except Exception as e:
            return {"success": False, "error": f"Scroll failed: {e}"}

    elif action == "evaluate":
        if not args:
            return {"success": False, "error": "evaluate requires JavaScript code"}
        js_code = args[0]
        page = await get_current_page()
        try:
            result = await page.evaluate(js_code)
            return {"success": True, "result": json.dumps(result, default=str, indent=2)}
        except Exception as e:
            return {"success": False, "error": f"JS evaluation failed: {e}"}

    elif action == "back":
        page = await get_current_page()
        try:
            await page.go_back(timeout=15000)
            await page.wait_for_timeout(500)
            snapshot = await take_snapshot(page)
            return {"success": True, "result": f"Navigated back.\n\n{snapshot}"}
        except Exception as e:
            return {"success": False, "error": f"Back navigation failed: {e}"}

    elif action == "forward":
        page = await get_current_page()
        try:
            await page.go_forward(timeout=15000)
            await page.wait_for_timeout(500)
            snapshot = await take_snapshot(page)
            return {"success": True, "result": f"Navigated forward.\n\n{snapshot}"}
        except Exception as e:
            return {"success": False, "error": f"Forward navigation failed: {e}"}

    elif action == "tabs":
        result_lines = []
        for i, (tid, page) in enumerate(pages.items()):
            marker = " *" if tid == current_tab else ""
            try:
                title = await page.title()
                url = page.url
            except Exception:
                title = "(closed)"
                url = ""
            result_lines.append(f"  [{i}] {title} -- {url}{marker}")
        return {"success": True, "result": "Open tabs:\n" + "\n".join(result_lines)}

    elif action == "close":
        global current_tab
        if current_tab in pages:
            page = pages.pop(current_tab)
            try:
                await page.close()
            except Exception:
                pass
            # Switch to another tab
            if pages:
                current_tab = list(pages.keys())[-1]
                snapshot = await take_snapshot(pages[current_tab])
                return {"success": True, "result": f"Tab closed. Switched to another tab.\n\n{snapshot}"}
            else:
                current_tab = None
                return {"success": True, "result": "Tab closed. No tabs remaining."}
        return {"success": True, "result": "No tab to close."}

    elif action == "wait":
        ms = 1000
        if args:
            try:
                ms = int(args[0])
            except ValueError:
                pass
        ms = min(ms, 30000)  # Cap at 30 seconds
        page = await get_current_page()
        await page.wait_for_timeout(ms)
        return {"success": True, "result": f"Waited {ms}ms."}

    else:
        return {
            "success": False,
            "error": f"Unknown action: {action}. Available: navigate, snapshot, click, type, screenshot, scroll, evaluate, back, forward, tabs, close, wait",
        }


class BridgeHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the browser bridge."""

    def log_message(self, format, *args):
        pass  # Suppress default logging

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/action":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")

        try:
            data = json.loads(body)
            action = data.get("action", "")
            args = data.get("args", [])
        except (json.JSONDecodeError, KeyError) as e:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": f"Invalid JSON: {e}"}).encode())
            return

        # Run async action in the event loop
        future = asyncio.run_coroutine_threadsafe(handle_action(action, args), event_loop)
        try:
            result = future.result(timeout=120)
        except Exception as e:
            result = {"success": False, "error": f"Execution error: {e}"}

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result, default=str).encode())


async def cleanup():
    """Cleanup browser resources."""
    global browser_instance, playwright_instance
    if browser_instance:
        try:
            await browser_instance.close()
        except Exception:
            pass
        browser_instance = None
    if playwright_instance:
        try:
            await playwright_instance.stop()
        except Exception:
            pass
        playwright_instance = None


def idle_watchdog(server):
    """Shut down server after idle timeout."""
    while True:
        time.sleep(60)
        if time.time() - last_activity > IDLE_TIMEOUT:
            print("Browser bridge idle timeout -- shutting down.", file=sys.stderr)
            # Cleanup in event loop
            if event_loop and event_loop.is_running():
                asyncio.run_coroutine_threadsafe(cleanup(), event_loop)
                time.sleep(1)
            server.shutdown()
            break


def run_event_loop(loop):
    """Run asyncio event loop in a dedicated thread."""
    asyncio.set_event_loop(loop)
    loop.run_forever()


def main():
    global event_loop

    parser = argparse.ArgumentParser(description="Moxxy browser bridge server")
    parser.add_argument("--port", type=int, default=18791)
    parser.add_argument("--pid-file", type=str, default="")
    args = parser.parse_args()

    # Create and start asyncio event loop in background thread
    event_loop = asyncio.new_event_loop()
    loop_thread = threading.Thread(target=run_event_loop, args=(event_loop,), daemon=True)
    loop_thread.start()

    # Write PID file
    if args.pid_file:
        with open(args.pid_file, "w") as f:
            f.write(str(os.getpid()))

    # Start HTTP server
    server = HTTPServer(("127.0.0.1", args.port), BridgeHandler)

    # Start idle watchdog
    watchdog = threading.Thread(target=idle_watchdog, args=(server,), daemon=True)
    watchdog.start()

    # Handle signals
    def shutdown_handler(sig, frame):
        print("Browser bridge shutting down...", file=sys.stderr)
        asyncio.run_coroutine_threadsafe(cleanup(), event_loop)
        server.shutdown()

    signal.signal(signal.SIGTERM, shutdown_handler)
    signal.signal(signal.SIGINT, shutdown_handler)

    print(f"Browser bridge listening on http://127.0.0.1:{args.port}", file=sys.stderr)

    try:
        server.serve_forever()
    finally:
        # Cleanup
        future = asyncio.run_coroutine_threadsafe(cleanup(), event_loop)
        try:
            future.result(timeout=5)
        except Exception:
            pass
        event_loop.call_soon_threadsafe(event_loop.stop)
        if args.pid_file and os.path.exists(args.pid_file):
            os.remove(args.pid_file)


if __name__ == "__main__":
    main()
