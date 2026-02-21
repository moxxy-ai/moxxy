import sys
import asyncio
from playwright.async_api import async_playwright
import html2text

async def main():
    if len(sys.argv) < 2:
        print("Usage: web_crawler <URL>")
        sys.exit(1)
    url = sys.argv[1]
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Use stealthy context settings to evade basic bot blocks
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        try:
            # wait_until="networkidle" is more robust for SPAs
            await page.goto(url, wait_until="networkidle", timeout=45000)
            
            # Extract content from the DOM
            html = await page.content()
            h = html2text.HTML2Text()
            h.ignore_links = False
            h.ignore_images = True
            h.body_width = 0 # No word wrap which is better for LLMs
            text = h.handle(html)
            
            if not text.strip():
                 print(f"Warning: Extracted content for {url} is empty.")
            else:
                print(f"--- CONTENT FOR {url} ---")
                # Limit the output to roughly 15,000 characters
                limit = 15000
                output = text[:limit]
                if len(text) > limit:
                    output += "\n\n... [TRUNCATED - PAGE TOO LONG] ..."
                print(output)
        except Exception as e:
            print(f"Warning: networkidle failed for {url}: {e}", file=sys.stderr)
            # Try a fallback with less strict wait condition
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                html = await page.content()
                h = html2text.HTML2Text()
                h.ignore_links = False
                h.ignore_images = True
                h.body_width = 0
                text = h.handle(html)
                if text.strip():
                    print(f"--- CONTENT FOR {url} (Fallback) ---")
                    limit = 15000
                    output = text[:limit]
                    if len(text) > limit:
                        output += "\n\n... [TRUNCATED - PAGE TOO LONG] ..."
                    print(output)
                else:
                    print(f"Error: Could not extract content from {url}")
                    sys.exit(1)
            except Exception as e2:
                print(f"Error: Both crawl attempts failed for {url}: {e2}")
                sys.exit(1)
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
