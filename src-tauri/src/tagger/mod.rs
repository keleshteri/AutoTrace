//! Keyword / rules-based session tagging.
//!
//! Phase 0: stub. MVP will match `rules.pattern` against app/title/URL
//! and assign client → project → task offline. AI-assisted tagging is Phase 2.

#![allow(dead_code)]

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct TagSuggestion {
    pub client_id: Option<i64>,
    pub project_id: Option<i64>,
    pub task_id: Option<i64>,
    pub rule_id: Option<i64>,
    pub confidence: f32,
}

/// Offline rules engine (not yet wired to the store).
pub struct Tagger;

impl Tagger {
    pub fn new() -> Self {
        Self
    }

    /// Returns `None` until rules evaluation is implemented.
    pub fn suggest(
        &self,
        _app_name: &str,
        _title: Option<&str>,
        _url: Option<&str>,
    ) -> Option<TagSuggestion> {
        None
    }
}

impl Default for Tagger {
    fn default() -> Self {
        Self::new()
    }
}
