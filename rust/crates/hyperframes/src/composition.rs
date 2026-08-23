use crate::scan::{find_matching_close, find_tag_with_attr, get_tag_attribute, remove_tag_attribute, set_tag_attribute};
use regex::Regex;
use serde::{Deserialize, Serialize};

pub const MAX_HTML_CHARS: usize = 1_000_000;
pub const MASTER_MARKER: &str = "data-opencut-master";
pub const INSERT_MARKER_COMMENT: &str = "<!--opencut-chat-insert-->";
pub const DEFAULT_DURATION_SECS: f64 = 5.0;
pub const DEFAULT_WIDTH: u32 = 1920;
pub const DEFAULT_HEIGHT: u32 = 1080;

#[derive(Debug, thiserror::Error)]
pub enum CompositionError {
    #[error("composition exceeds the {MAX_HTML_CHARS} character limit")]
    TooLarge,
    #[error("no element with a data-composition-id attribute was found")]
    MissingCompositionId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositionInfo {
    pub composition_id: String,
    pub duration_secs: f64,
    pub width: u32,
    pub height: u32,
    pub is_master: bool,
    pub child_count: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum AppendError {
    #[error("document is not an OpenCut master composition (missing {MASTER_MARKER})")]
    NotMaster,
    #[error("master document has no data-composition-id root")]
    MissingRoot,
    #[error(transparent)]
    Invalid(#[from] CompositionError),
}

fn clamp_duration(raw: Option<&str>) -> f64 {
    raw.and_then(|v| v.trim().parse::<f64>().ok())
        .map(|d| d.clamp(0.1, 3600.0))
        .unwrap_or(DEFAULT_DURATION_SECS)
}

/// Validates agent-produced composition HTML and extracts layout facts.
pub fn validate_composition(html: &str) -> Result<CompositionInfo, CompositionError> {
    if html.len() > MAX_HTML_CHARS {
        return Err(CompositionError::TooLarge);
    }
    let root = find_tag_with_attr(html, "data-composition-id", None)
        .ok_or(CompositionError::MissingCompositionId)?;
    let tag = &html[root.range.clone()];
    let composition_id = get_tag_attribute(tag, "data-composition-id").unwrap_or_default();
    let duration = clamp_duration(get_tag_attribute(tag, "data-duration").as_deref());
    let width = get_tag_attribute(tag, "data-width")
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|w| *w > 0)
        .unwrap_or(DEFAULT_WIDTH);
    let height = get_tag_attribute(tag, "data-height")
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|h| *h > 0)
        .unwrap_or(DEFAULT_HEIGHT);
    let is_master = tag.contains(MASTER_MARKER);
    let child_count = html.matches("data-composition-src").count();

    Ok(CompositionInfo { composition_id, duration_secs: duration, width, height, is_master, child_count })
}

/// Extracts the composition HTML document from an agent reply. Prefers a
/// ```html fenced block containing `data-composition-id`, then any doctype
/// document containing it.
pub fn extract_html(text: &str) -> Option<String> {
    let fence_re = Regex::new(r"(?s)```(?:html|HTML)\s*\n(.*?)\n?```").expect("static regex");
    for caps in fence_re.captures_iter(text) {
        if let Some(body) = caps.get(1) {
            if body.as_str().contains("data-composition-id") {
                return Some(body.as_str().to_string());
            }
        }
    }
    if let Some(start) = text.find("<!DOCTYPE html").or_else(|| text.find("<!doctype html")) {
        if let Some(end_rel) = text[start..].rfind("</html>") {
            let end = start + end_rel + "</html>".len();
            let doc = &text[start..end];
            if doc.contains("data-composition-id") {
                return Some(doc.to_string());
            }
        }
    }
    None
}

#[derive(Debug, Clone)]
pub struct SeedSpec<'a> {
    pub composition_id: &'a str,
    pub width: u32,
    pub height: u32,
    pub duration_secs: f64,
    pub fps: u32,
}

/// Builds the fresh-composition starting point handed to the agent each turn.
pub fn seed_composition(spec: &SeedSpec<'_>) -> String {
    let id = spec.composition_id;
    format!(
        r##"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{id}</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<style>
  html, body {{ margin: 0; padding: 0; background: #000; overflow: hidden; }}
  #{id} {{ position: relative; width: {width}px; height: {height}px; overflow: hidden; }}
</style>
</head>
<body>
<div id="{id}" data-composition-id="{id}" data-start="0" data-duration="{duration}" data-width="{width}" data-height="{height}">
{INSERT_MARKER_COMMENT}
  <h1 class="clip" data-start="0" data-duration="{duration}" data-track-index="0"
      style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font:700 {font}px sans-serif;">
    New scene
  </h1>
</div>
<script>
  window.__timelines = window.__timelines || {{}};
  window.__timelines["{id}"] = (function () {{
    const rootSel = "#" + "{id}";
    const tl = gsap.timeline({{ paused: true }});
    tl.from(rootSel + " h1", {{ opacity: 0, y: 40, duration: 0.8 }}, 0);
    return tl;
  }})();
</script>
</body>
</html>"##,
        id = id,
        width = spec.width,
        height = spec.height,
        duration = format_duration(spec.duration_secs),
        font = (spec.height as f64 * 0.07).round(),
        INSERT_MARKER_COMMENT = INSERT_MARKER_COMMENT,
    )
}

/// Builds a master wrapper document around the first generated child.
pub fn new_master_document(first_child_html: &str) -> Result<String, AppendError> {
    let info = validate_composition(first_child_html)?;
    let child_path = "compositions/001-scene.html";
    let host_id = "opencut-host-001";
    Ok(format!(
        r#"<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>OpenCut master</title>
<style>
  html, body {{ margin: 0; padding: 0; background: #000; overflow: hidden; }}
</style>
</head>
<body>
<div id="opencut-master" data-composition-id="opencut-master" data-start="0" data-duration="{duration}" data-width="{width}" data-height="{height}" {MASTER_MARKER}="1">
{INSERT_MARKER_COMMENT}
  <div class="clip" id="{host_id}" data-composition-id="{host_id}" data-composition-src="{child_path}" data-start="0" data-duration="{duration}" data-track-index="0"></div>
</div>
</body>
</html>"#,
        duration = format_duration(info.duration_secs),
        width = info.width,
        height = info.height,
        MASTER_MARKER = MASTER_MARKER,
        INSERT_MARKER_COMMENT = INSERT_MARKER_COMMENT,
    ))
}

/// Normalizes a generated child so it can be appended to the master:
/// renames its composition id, forces `data-start="0"` on the root and
/// removes any root `data-track-index`, uniquifies element ids.
pub fn normalize_child(child_html: &str, slug: &str) -> Result<String, CompositionError> {
    let info = validate_composition(child_html)?;
    let old_id = info.composition_id.as_str();
    let new_id = format!("opencut-{slug}");
    let mut out = String::with_capacity(child_html.len() + slug.len() * 4);
    if old_id.is_empty() {
        out.push_str(child_html);
    } else {
        out.push_str(&child_html.replace(old_id, &new_id));
    }

    // Uniquify ids: prefix every id="..." that is not already prefixed.
    let id_re = Regex::new(r#"\bid\s*=\s*"([^"]+)""#).expect("static regex");
    let mut deduped = String::with_capacity(out.len());
    let mut last = 0;
    for caps in id_re.captures_iter(&out) {
        let whole = caps.get(0).unwrap();
        let value = caps.get(1).unwrap().as_str();
        if value.starts_with(&new_id) || value.starts_with("opencut-host-") {
            continue;
        }
        deduped.push_str(&out[last..whole.start()]);
        deduped.push_str(&format!("id=\"{}-{value}\"", new_id));
        last = whole.end();
    }
    deduped.push_str(&out[last..]);
    out = deduped;

    // Root fixes: start at zero, no track index of its own.
    let root = find_tag_with_attr(&out, "data-composition-id", Some(&new_id))
        .ok_or(CompositionError::MissingCompositionId)?;
    let tag = &out[root.range.clone()];
    let fixed = set_tag_attribute(tag, "data-start", "0");
    let fixed = remove_tag_attribute(&fixed, "data-track-index");
    out.replace_range(root.range, &fixed);

    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct AppendOutcome {
    pub master_html: String,
    pub child_file_name: String,
    pub host_start_secs: f64,
    pub total_duration_secs: f64,
}

/// Appends a normalized child composition file reference to the master host
/// document, extending the master duration.
pub fn append_child_to_master(
    master_html: &str,
    normalized_child: &str,
    child_file_stem: &str,
) -> Result<AppendOutcome, AppendError> {
    if !master_html.contains(MASTER_MARKER) {
        return Err(AppendError::NotMaster);
    }
    let child_info = validate_composition(normalized_child)?;
    let master_root = find_tag_with_attr(master_html, MASTER_MARKER, None).ok_or(AppendError::MissingRoot)?;

    // Next sequential slot.
    let index_re =
        Regex::new(r#"data-composition-src="compositions/(\d{3})-"#).expect("static regex");
    let next_index = index_re
        .captures_iter(master_html)
        .filter_map(|caps| caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok()))
        .max()
        .unwrap_or(0)
        + 1;

    let child_file_name = format!("{next_index:03}-{child_file_stem}.html");
    let host_id = format!("opencut-host-{next_index:03}");

    // Master timeline facts.
    let master_tag = &master_html[master_root.range.clone()];
    let master_duration_raw = get_tag_attribute(master_tag, "data-duration");
    let master_duration = clamp_duration(master_duration_raw.as_deref());

    // Latest occupied end among existing hosts.
    let host_re = Regex::new(
        r#"data-composition-id="(opencut-host-\d+)"[^>]*data-start="([0-9.]+)"[^>]*data-duration="([0-9.]+)""#,
    )
    .expect("static regex");
    let mut max_end = master_duration;
    for caps in host_re.captures_iter(master_html) {
        let start: f64 = caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0.0);
        let dur: f64 = caps.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0.0);
        max_end = max_end.max(start + dur);
    }
    let host_start = max_end;
    let total_duration = host_start + child_info.duration_secs;

    let host_div = format!(
        "<div class=\"clip\" id=\"{host_id}\" data-composition-id=\"{host_id}\" data-composition-src=\"compositions/{file}\" data-start=\"{start}\" data-duration=\"{dur}\" data-track-index=\"0\"></div>",
        host_id = host_id,
        file = child_file_name,
        start = format_duration(host_start),
        dur = format_duration(child_info.duration_secs),
    );

    // Insertion point: marker comment inside the root, else before root close.
    let insertion_abs = match master_html.find(INSERT_MARKER_COMMENT) {
        Some(marker_pos) => marker_pos + INSERT_MARKER_COMMENT.len(),
        None => find_matching_close(master_html, &master_root).unwrap_or(master_root.content_start),
    };

    let mut updated = String::with_capacity(master_html.len() + host_div.len());
    updated.push_str(&master_html[..insertion_abs]);
    updated.push('\n');
    updated.push_str("  ");
    updated.push_str(&host_div);
    updated.push_str(&master_html[insertion_abs..]);

    // Extend master duration.
    let updated_root = find_tag_with_attr(&updated, MASTER_MARKER, None).ok_or(AppendError::MissingRoot)?;
    let tag = &updated[updated_root.range.clone()];
    let extended = set_tag_attribute(tag, "data-duration", &format_duration(total_duration));
    updated.replace_range(updated_root.range, &extended);

    Ok(AppendOutcome {
        master_html: updated,
        child_file_name,
        host_start_secs: host_start,
        total_duration_secs: total_duration,
    })
}

fn format_duration(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    if (rounded - rounded.trunc()).abs() < f64::EPSILON {
        format!("{}", rounded.trunc() as i64)
    } else {
        format!("{rounded}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_child(id: &str) -> String {
        format!(
            r#"<!DOCTYPE html><html><body><div id="{id}" data-composition-id="{id}" data-start="0" data-duration="3" data-width="1920" data-height="1080"><h1 id="title" class="clip" data-start="0" data-duration="3" data-track-index="0">Hi</h1></div><script>window.__timelines=window.__timelines||{{}};window.__timelines["{id}"]=gsap.timeline({{paused:true}});</script></body></html>"#
        )
    }

    #[test]
    fn validates_and_extracts_layout() {
        let info = validate_composition(&sample_child("abc")).unwrap();
        assert_eq!(info.composition_id, "abc");
        assert_eq!(info.duration_secs, 3.0);
        assert_eq!(info.width, 1920);
        assert!(!info.is_master);
    }

    #[test]
    fn rejects_missing_root() {
        assert!(matches!(
            validate_composition("<html><body>nope</body></html>"),
            Err(CompositionError::MissingCompositionId)
        ));
    }

    #[test]
    fn extracts_fenced_html() {
        let reply = format!("Here you go:\n```html\n{}\n```\nDone.", sample_child("x1"));
        let extracted = extract_html(&reply).unwrap();
        assert!(extracted.contains("data-composition-id"));
    }

    #[test]
    fn normalizes_child_ids_and_root() {
        let normalized = normalize_child(&sample_child("chat-1"), "abc123").unwrap();
        assert!(!normalized.contains("\"chat-1\""));
        assert!(normalized.contains("opencut-abc123"));
        assert!(normalized.contains("opencut-abc123-title"));
        let root = find_tag_with_attr(&normalized, "data-composition-id", Some("opencut-abc123")).unwrap();
        let tag = &normalized[root.range.clone()];
        assert_eq!(get_tag_attribute(tag, "data-start").as_deref(), Some("0"));
        assert_eq!(get_tag_attribute(tag, "data-track-index"), None);
    }

    #[test]
    fn appends_children_to_master_sequentially() {
        let first = normalize_child(&sample_child("c1"), "c1").unwrap();
        let master = new_master_document(&first).unwrap();
        assert!(master.contains(MASTER_MARKER));

        let second = normalize_child(&sample_child("c2"), "c2").unwrap();
        let outcome = append_child_to_master(&master, &second, "scene-two").unwrap();
        assert_eq!(outcome.child_file_name, "002-scene-two.html");
        assert_eq!(outcome.host_start_secs, 3.0);
        assert_eq!(outcome.total_duration_secs, 6.0);
        assert!(outcome.master_html.contains("002-scene-two.html"));

        let third = normalize_child(&sample_child("c3"), "c3").unwrap();
        let again = append_child_to_master(&outcome.master_html, &third, "scene-three").unwrap();
        assert_eq!(again.host_start_secs, 6.0);
        assert_eq!(again.total_duration_secs, 9.0);
        assert!(again.master_html.contains("003-scene-three.html"));
    }

    #[test]
    fn seeds_reference_document() {
        let seed = seed_composition(&SeedSpec {
            composition_id: "seed-1",
            width: 1080,
            height: 1920,
            duration_secs: 5.0,
            fps: 30,
        });
        assert!(seed.contains("data-composition-id=\"seed-1\""));
        assert!(seed.contains("__timelines[\"seed-1\"]"));
        assert!(validate_composition(&seed).is_ok());
    }
}
