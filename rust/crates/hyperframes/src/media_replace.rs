use crate::{scan, validate_composition};
use regex::Regex;
use serde::{Deserialize, Serialize};

const LOCAL_MEDIA_PREFIX: &str = "opencut-media://local/";

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageFit {
    #[default]
    Contain,
    Cover,
    Fill,
}

impl ImageFit {
    fn preserve_aspect_ratio(self) -> &'static str {
        match self {
            Self::Contain => "xMidYMid meet",
            Self::Cover => "xMidYMid slice",
            Self::Fill => "none",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Contain => "contain",
            Self::Cover => "cover",
            Self::Fill => "fill",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualTarget {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub hf_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceImageOutcome {
    pub html: String,
    pub warnings: Vec<String>,
}

fn escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn tag_name(tag: &str) -> Option<String> {
    let trimmed = tag.trim_start_matches('<').trim_start();
    let end = trimmed
        .find(|character: char| character.is_whitespace() || character == '>' || character == '/')
        .unwrap_or(trimmed.len());
    (end > 0).then(|| trimmed[..end].to_ascii_lowercase())
}

fn set_attribute(tag: &str, name: &str, value: &str) -> String {
    let pattern = Regex::new(&format!(
        r#"(?i)\s{}\s*=\s*(?:\"[^\"]*\"|'[^']*')"#,
        regex::escape(name)
    ));
    let escaped = escape_attribute(value);
    if let Ok(pattern) = pattern {
        if let Some(found) = pattern.find(tag) {
            return format!(
                "{} {}=\"{}\"{}",
                &tag[..found.start()],
                name,
                escaped,
                &tag[found.end()..]
            );
        }
    }
    let insert_at = tag
        .rfind("/>")
        .or_else(|| tag.rfind('>'))
        .unwrap_or(tag.len());
    format!(
        "{} {}=\"{}\"{}",
        &tag[..insert_at].trim_end(),
        name,
        escaped,
        &tag[insert_at..]
    )
}

fn remove_attribute(tag: &str, name: &str) -> String {
    let pattern = Regex::new(&format!(
        r#"(?i)\s{}(?:\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+))?"#,
        regex::escape(name)
    ));
    pattern
        .ok()
        .map(|pattern| pattern.replace_all(tag, "").into_owned())
        .unwrap_or_else(|| tag.to_string())
}

fn find_target(html: &str, target: &VisualTarget) -> Option<scan::TagSpan> {
    target
        .id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .and_then(|value| scan::find_tag_with_attr(html, "id", Some(value)))
        .or_else(|| {
            target
                .hf_id
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .and_then(|value| scan::find_tag_with_attr(html, "data-hf-id", Some(value)))
        })
}

fn matching_close_range(
    html: &str,
    content_start: usize,
    name: &str,
) -> Option<std::ops::Range<usize>> {
    let pattern = Regex::new(&format!(r"(?is)</?{}\b[^>]*>", regex::escape(name))).ok()?;
    let mut depth = 1usize;
    for found in pattern.find_iter(&html[content_start..]) {
        let candidate = found.as_str();
        if candidate
            .strip_prefix('<')
            .is_some_and(|rest| rest.trim_start().starts_with('/'))
        {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(content_start + found.start()..content_start + found.end());
            }
        } else if !candidate.trim_end().ends_with("/>") {
            depth += 1;
        }
    }
    None
}

fn marked_tag(tag: &str, media_id: &str, media_name: &str, fit: ImageFit) -> String {
    let tag = remove_attribute(tag, "data-opencut-selected-image");
    let tag = set_attribute(&tag, "data-opencut-media-id", media_id);
    let tag = set_attribute(&tag, "data-opencut-media-name", media_name);
    set_attribute(&tag, "data-opencut-media-fit", fit.as_str())
}

pub fn replace_visual_with_image(
    html: &str,
    target: &VisualTarget,
    media_url: &str,
    media_id: &str,
    media_name: &str,
    fit: ImageFit,
) -> Result<ReplaceImageOutcome, String> {
    if !media_url.starts_with(LOCAL_MEDIA_PREFIX) {
        return Err("replacement image must be frozen into the project first".to_string());
    }
    if media_id.trim().is_empty() {
        return Err("replacement image is missing its media id".to_string());
    }
    let span = find_target(html, target)
        .ok_or_else(|| "the selected preview element no longer exists in the source".to_string())?;
    let original_tag = &html[span.range.clone()];
    let name =
        tag_name(original_tag).ok_or_else(|| "selected element has no tag name".to_string())?;
    let mut warnings = Vec::new();

    let next_html = match name.as_str() {
        "img" => {
            let tag = set_attribute(original_tag, "src", media_url);
            let tag = set_attribute(&tag, "alt", media_name);
            let tag = marked_tag(&tag, media_id, media_name, fit);
            format!(
                "{}{}{}",
                &html[..span.range.start],
                tag,
                &html[span.range.end..]
            )
        }
        "image" => {
            let tag = set_attribute(original_tag, "href", media_url);
            let tag = marked_tag(&tag, media_id, media_name, fit);
            format!(
                "{}{}{}",
                &html[..span.range.start],
                tag,
                &html[span.range.end..]
            )
        }
        "svg" => {
            let close = matching_close_range(html, span.content_start, "svg")
                .ok_or_else(|| "selected SVG has no matching closing tag".to_string())?;
            let removed = &html[span.content_start..close.start];
            if removed.contains("id=") || removed.contains("data-hf-id=") {
                warnings.push(
                    "The SVG's inner shapes were replaced; animations targeting those child shapes may no longer run. Root SVG animation and layout were preserved."
                        .to_string(),
                );
            }
            let outer = marked_tag(original_tag, media_id, media_name, fit);
            let image = format!(
                "<image href=\"{}\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\" preserveAspectRatio=\"{}\" data-opencut-media-id=\"{}\" data-opencut-media-name=\"{}\" />",
                escape_attribute(media_url),
                fit.preserve_aspect_ratio(),
                escape_attribute(media_id),
                escape_attribute(media_name),
            );
            format!(
                "{}{}{}</svg>{}",
                &html[..span.range.start],
                outer,
                image,
                &html[close.end..]
            )
        }
        _ => {
            return Err(format!(
                "{} elements cannot be replaced with media; drop onto an image or SVG",
                name
            ));
        }
    };

    validate_composition(&next_html).map_err(|error| error.to_string())?;
    Ok(ReplaceImageOutcome {
        html: next_html,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(content: &str) -> String {
        format!(r#"<html><body><div data-composition-id="c1">{content}</div></body></html>"#)
    }

    #[test]
    fn replaces_img_source_and_preserves_layout() {
        let html = document(
            r#"<img id="hero" class="wide" src="old.png" data-opencut-selected-image="old-search-result">"#,
        );
        let result = replace_visual_with_image(
            &html,
            &VisualTarget {
                id: Some("hero".into()),
                hf_id: None,
            },
            "opencut-media://local/C%3A%5Cphoto.png",
            "media-1",
            "Photo & portrait",
            ImageFit::Cover,
        )
        .unwrap();
        assert!(result.html.contains("class=\"wide\""));
        assert!(result.html.contains("src=\"opencut-media://local/"));
        assert!(result.html.contains("data-opencut-media-fit=\"cover\""));
        assert!(result.html.contains("alt=\"Photo &amp; portrait\""));
        assert!(!result.html.contains("data-opencut-selected-image"));
    }

    #[test]
    fn replaces_svg_children_but_keeps_the_animated_root() {
        let html = document(
            r#"<svg data-hf-id="logo" class="spin" viewBox="0 0 40 40"><g id="pieces"><path d="M0 0"/></g></svg>"#,
        );
        let result = replace_visual_with_image(
            &html,
            &VisualTarget {
                id: None,
                hf_id: Some("logo".into()),
            },
            "opencut-media://local/logo.png",
            "media-2",
            "New logo",
            ImageFit::Contain,
        )
        .unwrap();
        assert!(
            result
                .html
                .contains("<svg data-hf-id=\"logo\" class=\"spin\" viewBox=\"0 0 40 40\"")
        );
        assert!(
            result
                .html
                .contains("<image href=\"opencut-media://local/logo.png\"")
        );
        assert!(!result.html.contains("<path"));
        assert_eq!(result.warnings.len(), 1);
    }

    #[test]
    fn rejects_non_visual_targets_and_unfrozen_urls() {
        let html = document(r#"<div id="box"></div>"#);
        let target = VisualTarget {
            id: Some("box".into()),
            hf_id: None,
        };
        assert!(
            replace_visual_with_image(&html, &target, "blob:test", "m", "x", ImageFit::Contain)
                .is_err()
        );
        assert!(
            replace_visual_with_image(
                &html,
                &target,
                "opencut-media://local/x",
                "m",
                "x",
                ImageFit::Contain
            )
            .is_err()
        );
    }
}
