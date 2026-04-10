//! Interaction primitives: click, type, fill, hover, scroll.
//!
//! All five share the same shape: forward params to the matching sidecar
//! method, propagate timeout. Locator-based, with auto-waiting from Playwright.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;

use crate::browser::BrowserManager;
use crate::registry::{Primitive, PrimitiveError};

fn timeout_from_params(params: &serde_json::Value) -> Option<Duration> {
    params["timeout_ms"].as_u64().map(Duration::from_millis)
}

macro_rules! interaction_primitive {
    ($struct:ident, $name:literal, $method:literal, $desc:literal, $schema:expr) => {
        pub struct $struct {
            manager: Arc<BrowserManager>,
        }
        impl $struct {
            pub fn new(manager: Arc<BrowserManager>) -> Self {
                Self { manager }
            }
        }
        #[async_trait]
        impl Primitive for $struct {
            fn name(&self) -> &str {
                $name
            }
            fn description(&self) -> &str {
                $desc
            }
            fn parameters_schema(&self) -> serde_json::Value {
                $schema
            }
            async fn invoke(
                &self,
                params: serde_json::Value,
            ) -> Result<serde_json::Value, PrimitiveError> {
                let timeout = timeout_from_params(&params);
                self.manager.request($method, params, timeout).await
            }
        }
    };
}

interaction_primitive!(
    BrowserClickPrimitive,
    "browser.click",
    "page.click",
    "Click an element matched by a CSS selector. Auto-waits for the element to be visible \
     and stable before clicking.",
    serde_json::json!({
        "type": "object",
        "properties": {
            "page_id": {"type": "string"},
            "selector": {"type": "string"},
            "button": {"type": "string", "enum": ["left", "right", "middle"]},
            "click_count": {"type": "integer"},
            "force": {"type": "boolean"},
            "timeout_ms": {"type": "integer"}
        },
        "required": ["page_id", "selector"]
    })
);

interaction_primitive!(
    BrowserTypePrimitive,
    "browser.type",
    "page.type",
    "Type text into an element character-by-character (with optional delay between keys). \
     Use this for inputs that need keystroke events. Use browser.fill for one-shot text input.",
    serde_json::json!({
        "type": "object",
        "properties": {
            "page_id": {"type": "string"},
            "selector": {"type": "string"},
            "text": {"type": "string"},
            "delay_ms": {"type": "integer"},
            "clear_first": {"type": "boolean"},
            "timeout_ms": {"type": "integer"}
        },
        "required": ["page_id", "selector", "text"]
    })
);

interaction_primitive!(
    BrowserFillPrimitive,
    "browser.fill",
    "page.fill",
    "Set the value of an input/textarea/select in one shot. Faster than browser.type for \
     ordinary form fields.",
    serde_json::json!({
        "type": "object",
        "properties": {
            "page_id": {"type": "string"},
            "selector": {"type": "string"},
            "value": {"type": "string"},
            "timeout_ms": {"type": "integer"}
        },
        "required": ["page_id", "selector", "value"]
    })
);

interaction_primitive!(
    BrowserHoverPrimitive,
    "browser.hover",
    "page.hover",
    "Hover the mouse over an element matched by a CSS selector.",
    serde_json::json!({
        "type": "object",
        "properties": {
            "page_id": {"type": "string"},
            "selector": {"type": "string"},
            "timeout_ms": {"type": "integer"}
        },
        "required": ["page_id", "selector"]
    })
);

interaction_primitive!(
    BrowserScrollPrimitive,
    "browser.scroll",
    "page.scroll",
    "Scroll the page. Pass `selector` to scroll a specific element into view, or `direction` \
     ('top'|'bottom'|'to') for whole-page scrolling. With direction='to', pass `x` and `y`.",
    serde_json::json!({
        "type": "object",
        "properties": {
            "page_id": {"type": "string"},
            "selector": {"type": "string"},
            "direction": {"type": "string", "enum": ["top", "bottom", "to"]},
            "x": {"type": "integer"},
            "y": {"type": "integer"},
            "timeout_ms": {"type": "integer"}
        },
        "required": ["page_id"]
    })
);
