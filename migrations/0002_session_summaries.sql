-- Session summaries — one LLM-produced summary per completed run, FTS5-indexed
-- for cross-session recall. Written by the post-run reflection pass.
--
-- The table is intentionally an FTS5 virtual table so `session.recall` can
-- use MATCH queries directly. task + summary are indexed content columns;
-- ids and timestamps are UNINDEXED (we filter on them in Rust).

CREATE VIRTUAL TABLE IF NOT EXISTS session_summary USING fts5(
    run_id       UNINDEXED,
    agent_id     UNINDEXED,
    user_id      UNINDEXED,
    ts           UNINDEXED,
    tool_call_count UNINDEXED,
    task,
    summary,
    tokenize = 'porter'
);
