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
    if let Some(hit) = suggest_with_rules(&rules, app_name, title, url) {
        return Some(hit);
    }
    let ml_on = store
        .get_setting("ml_tagging")
        .ok()
        .flatten()
        .map(|v| v != "0")
        .unwrap_or(true);
    if ml_on {
        ml_keyword_suggest(
            app_name,
            &title.unwrap_or("").to_lowercase(),
            &url.unwrap_or("").to_lowercase(),
        )
    } else {
        None
    }
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

fn ml_keyword_suggest(app_name: &str, title_l: &str, url_l: &str) -> Option<TagSuggestion> {
    let blob = format!("{} {} {}", app_name.to_lowercase(), title_l, url_l);
    let banks: &[(&str, &[&str], f32)] = &[
        (
            "code",
            &[
                "github", "gitlab", "pull request", "stack overflow", "localhost", "rust",
                "typescript", "python", "refactor", "compile", "cargo", "npm", "debugger",
                "stackoverflow", "bitbucket", "jira", "linear.app", "vscode", "cursor",
            ],
            0.45,
        ),
        (
            "meeting",
            &[
                "agenda", "standup", "sync", "1:1", "interview", "webinar", "zoom.us",
                "meet.google", "teams.microsoft", "webex",
            ],
            0.44,
        ),
        (
            "docs",
            &[
                "notion", "confluence", "google docs", "readme", "specification", "wiki",
                "docs.google", "dropbox paper", "obsidian",
            ],
            0.4,
        ),
        (
            "comms",
            &["slack", "discord", "gmail", "outlook", "telegram", "whatsapp", "messenger"],
            0.38,
        ),
        (
            "distraction",
            &[
                "youtube", "twitter", "x.com", "reddit", "netflix", "tiktok", "instagram",
                "facebook", "twitch",
            ],
            0.36,
        ),
    ];
    let mut best: Option<(f32, &'static str)> = None;
    for (label, keys, base) in banks {
        let hits = keys.iter().filter(|k| blob.contains(*k)).count();
        if hits == 0 {
            continue;
        }
        let score = (base + hits as f32 * 0.06).min(0.78);
        if best.map(|(s, _)| score > s).unwrap_or(true) {
            best = Some((score, label));
        }
    }
    best.map(|(confidence, _)| TagSuggestion {
        client_id: None,
        project_id: None,
        task_id: None,
        rule_id: None,
        confidence,
        source: "ml_local",
    })
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

/// Infer a Rize-style category orthogonal to client/project/task.
pub fn infer_category(
    idle: bool,
    app_name: &str,
    title: Option<&str>,
    url: Option<&str>,
    notes: Option<&str>,
) -> &'static str {
    if idle {
        return "Break";
    }
    if notes
        .map(|n| n.eq_ignore_ascii_case("Focus session"))
        .unwrap_or(false)
        || title.map(|t| t.eq_ignore_ascii_case("focus")).unwrap_or(false)
    {
        return "Focus";
    }

    let blob = format!(
        "{} {} {}",
        app_name.to_lowercase(),
        title.unwrap_or("").to_lowercase(),
        url.unwrap_or("").to_lowercase()
    );

    const MEETING: &[&str] = &[
        "zoom", "meet.google", "teams", "webex", "slack huddle", "facetime",
        "skype", "whereby", "around.co", "meeting", "standup",
    ];
    if MEETING.iter().any(|k| blob.contains(k))
        || blob.contains(" call")
        || blob.starts_with("call ")
    {
        return "Meeting";
    }

    const CODE: &[&str] = &[
        "cursor", "code.exe", "code -", "visual studio", "jetbrains", "idea64",
        "webstorm", "pycharm", "goland", "clion", "rider", "android studio",
        "xcode", "terminal", "windows terminal", "powershell", "cmd.exe",
        "iterm", "warp", "alacritty", "kitty", "vim", "nvim", "emacs",
        "sublime", "notepad++", "github desktop", "gitkraken",
    ];
    if CODE.iter().any(|k| blob.contains(k)) {
        return "Code";
    }

    "Other"
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

    #[test]
    fn infers_categories() {
        assert_eq!(infer_category(true, "Idle", Some("Idle"), None, None), "Break");
        assert_eq!(
            infer_category(false, "Zoom", Some("Weekly call"), None, None),
            "Meeting"
        );
        assert_eq!(
            infer_category(false, "Cursor.exe", Some("main.rs"), None, None),
            "Code"
        );
        assert_eq!(
            infer_category(false, "App", Some("Focus"), None, Some("Focus session")),
            "Focus"
        );
    }
}
