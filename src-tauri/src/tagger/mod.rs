//! Keyword / rules-based session tagging (fully offline).
//! Phase 2: confidence scores; optional suggest-only when confirm-before-log is on.

use crate::store::{Rule, Store};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct TagSuggestion {
    pub client_id: Option<i64>,
    pub project_id: Option<i64>,
    pub task_id: Option<i64>,
    pub rule_id: Option<i64>,
    pub confidence: f32,
    pub source: &'static str,
}

/// Match enabled rules by priority (highest first). Pattern is case-insensitive substring.
pub fn suggest(
    store: &Store,
    app_name: &str,
    title: Option<&str>,
    url: Option<&str>,
) -> Option<TagSuggestion> {
    let rules = store.list_rules().ok()?;
    suggest_with_rules(&rules, app_name, title, url)
}

pub fn suggest_with_rules(
    rules: &[Rule],
    app_name: &str,
    title: Option<&str>,
    url: Option<&str>,
) -> Option<TagSuggestion> {
    let app_l = app_name.to_lowercase();
    let title_l = title.unwrap_or("").to_lowercase();
    let url_l = url.unwrap_or("").to_lowercase();

    let mut ranked: Vec<Rule> = rules
        .iter()
        .filter(|r| r.enabled && r.action != "exclude")
        .cloned()
        .collect();
    ranked.sort_by(|a, b| b.priority.cmp(&a.priority));

    for rule in &ranked {
        let pat = rule.pattern.to_lowercase();
        if pat.is_empty() {
            continue;
        }
        let hay = match rule.match_field.as_str() {
            "app" => app_l.as_str(),
            "url" => url_l.as_str(),
            _ => title_l.as_str(),
        };
        if let Some(confidence) = match_confidence(hay, &pat) {
            return Some(TagSuggestion {
                client_id: rule.client_id,
                project_id: rule.project_id,
                task_id: rule.task_id,
                rule_id: Some(rule.id),
                confidence,
                source: "rule",
            });
        }
    }

    // Phase 2 heuristic: weak app-name echo when no rule hits.
    heuristic_app_guess(app_name, &title_l)
}

fn match_confidence(haystack: &str, pattern: &str) -> Option<f32> {
    if !haystack.contains(pattern) {
        return None;
    }
    if haystack == pattern {
        return Some(0.98);
    }
    if haystack.starts_with(pattern) || haystack.ends_with(pattern) {
        return Some(0.9);
    }
    let ratio = pattern.len() as f32 / haystack.len().max(1) as f32;
    Some((0.55 + ratio * 0.4).clamp(0.55, 0.92))
}

fn heuristic_app_guess(app_name: &str, title_l: &str) -> Option<TagSuggestion> {
    let app_l = app_name.to_lowercase();
    let stem = app_l
        .trim_end_matches(".exe")
        .trim_end_matches(".app");
    if stem.len() < 3 || title_l.is_empty() {
        return None;
    }
    if title_l.contains(stem) {
        return Some(TagSuggestion {
            client_id: None,
            project_id: None,
            task_id: None,
            rule_id: None,
            confidence: 0.35,
            source: "heuristic",
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Rule;

    #[test]
    fn matches_title_with_confidence() {
        let rules = vec![Rule {
            id: 1,
            name: "Figma".into(),
            pattern: "figma".into(),
            match_field: "title".into(),
            client_id: Some(1),
            project_id: Some(2),
            task_id: None,
            priority: 10,
            enabled: true,
            action: "tag".into(),
        }];
        let hit = suggest_with_rules(&rules, "Figma", Some("Design in Figma"), None).unwrap();
        assert_eq!(hit.project_id, Some(2));
        assert!(hit.confidence >= 0.55);
        assert_eq!(hit.source, "rule");
    }

    #[test]
    fn higher_priority_wins() {
        let rules = vec![
            Rule {
                id: 1,
                name: "Low".into(),
                pattern: "design".into(),
                match_field: "title".into(),
                client_id: Some(1),
                project_id: Some(1),
                task_id: None,
                priority: 1,
                enabled: true,
                action: "tag".into(),
            },
            Rule {
                id: 2,
                name: "High".into(),
                pattern: "design".into(),
                match_field: "title".into(),
                client_id: Some(9),
                project_id: Some(9),
                task_id: None,
                priority: 100,
                enabled: true,
                action: "tag".into(),
            },
        ];
        let hit = suggest_with_rules(&rules, "App", Some("Design work"), None).unwrap();
        assert_eq!(hit.project_id, Some(9));
    }
}
