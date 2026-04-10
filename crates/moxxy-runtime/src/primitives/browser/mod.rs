//! `browser.*` primitives backed by a Playwright sidecar.
//!
//! Every primitive holds an `Arc<browser::BrowserManager>` (one per agent),
//! plus any per-primitive context (allowlist path, network mode, path policy).

pub mod core;
pub mod crawl;
pub mod interact;
pub mod session;

pub use core::{
    BrowserCookiesPrimitive, BrowserEvalPrimitive, BrowserExtractPrimitive,
    BrowserNavigatePrimitive, BrowserReadPrimitive, BrowserScreenshotPrimitive,
    BrowserWaitPrimitive,
};
pub use crawl::BrowserCrawlPrimitive;
pub use interact::{
    BrowserClickPrimitive, BrowserFillPrimitive, BrowserHoverPrimitive, BrowserScrollPrimitive,
    BrowserTypePrimitive,
};
pub use session::{
    BrowserSessionClosePrimitive, BrowserSessionListPrimitive, BrowserSessionOpenPrimitive,
};
