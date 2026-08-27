use std::ops::Range;

pub struct TagSpan {
    /// Range of the full tag including angle brackets, e.g. `<div ...>`.
    pub range: Range<usize>,
    /// Offset just past the closing `>` of the opening tag.
    pub content_start: usize,
}

fn is_attr_boundary(bytes: &[u8], pos: usize) -> bool {
    if pos == 0 {
        return false;
    }
    let b = bytes[pos - 1];
    b == b' ' || b == b'\t' || b == b'\n' || b == b'\r'
}

/// Finds the first opening tag containing `attr` (as a standalone attribute
/// name) and, when `value` is provided, whose value for that attribute equals
/// it. Returns the tag span.
pub fn find_tag_with_attr(html: &str, attr: &str, value: Option<&str>) -> Option<TagSpan> {
    let bytes = html.as_bytes();
    let mut search_from = 0;
    while let Some(rel) = html[search_from..].find(attr) {
        let abs = search_from + rel;
        search_from = abs + attr.len();
        if !is_attr_boundary(bytes, abs) {
            continue;
        }
        // Enclosing tag boundaries.
        let open = html[..abs].rfind('<')?;
        let close_rel = html[abs..].find('>')? + abs;
        if open + 1 >= bytes.len() || bytes[open + 1] == b'/' {
            continue;
        }
        let tag = &html[open..=close_rel];
        match value {
            Some(expected) => {
                if get_tag_attribute(tag, attr).as_deref() == Some(expected) {
                    return Some(TagSpan {
                        range: open..close_rel + 1,
                        content_start: close_rel + 1,
                    });
                }
            }
            None => {
                return Some(TagSpan {
                    range: open..close_rel + 1,
                    content_start: close_rel + 1,
                });
            }
        }
    }
    None
}

pub fn get_tag_attribute(tag: &str, name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let needle = format!("{name}");
    let bytes = lower.as_bytes();
    let mut from = 0;
    while let Some(rel) = lower[from..].find(&needle) {
        let abs = from + rel;
        from = abs + name.len();
        if abs > 0 && !is_attr_boundary(bytes, abs) {
            continue;
        }
        let rest = &tag[abs + name.len()..];
        let rest_trimmed = rest.trim_start();
        if !rest_trimmed.starts_with('=') {
            continue;
        }
        let after_eq = rest_trimmed[1..].trim_start();
        let quote = after_eq.chars().next()?;
        if quote != '"' && quote != '\'' {
            continue;
        }
        let value_part = &after_eq[1..];
        let end = value_part.find(quote)?;
        return Some(value_part[..end].to_string());
    }
    None
}

/// Returns the tag with `name` set to `value`, replacing or appending the
/// attribute in place (preserving surrounding markup).
pub fn set_tag_attribute(tag: &str, name: &str, value: &str) -> String {
    if let Some(current) = get_tag_attribute(tag, name) {
        let quoted_current = format!("\"{current}\"");
        let quoted_new = format!("\"{value}\"");
        return tag.replace(&quoted_current, &quoted_new);
    }
    // Append before the closing `>`.
    let trimmed_len = tag.trim_end().len();
    let insert_at = trimmed_len - 1;
    let mut out = String::with_capacity(tag.len() + name.len() + value.len() + 4);
    out.push_str(&tag[..insert_at]);
    if !out.ends_with(' ') && !out.ends_with('\n') && !out.ends_with('\t') {
        out.push(' ');
    }
    out.push_str(name);
    out.push_str("=\"");
    out.push_str(value);
    out.push_str("\"");
    out.push_str(&tag[insert_at..]);
    out
}

pub fn remove_tag_attribute(tag: &str, name: &str) -> String {
    let lower = tag.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut from = 0;
    while let Some(rel) = lower[from..].find(name) {
        let abs = from + rel;
        from = abs + name.len();
        if !is_attr_boundary(bytes, abs) {
            continue;
        }
        let rest = &tag[abs + name.len()..];
        let rest_trimmed = rest.trim_start();
        let ws_before = rest.len() - rest_trimmed.len();
        if !rest_trimmed.starts_with('=') {
            continue;
        }
        let after_eq = rest_trimmed[1..].trim_start();
        let eq_ws = rest_trimmed.len() - 1 - after_eq.len();
        let Some(quote) = after_eq.chars().next() else {
            continue;
        };
        if quote != '"' && quote != '\'' {
            continue;
        }
        let value_part = &after_eq[1..];
        let Some(end) = value_part.find(quote) else {
            continue;
        };
        let remove_start = abs - ws_before;
        let remove_end = abs + name.len() + ws_before + 1 + eq_ws + 1 + end + 2;
        let mut out = String::with_capacity(tag.len());
        out.push_str(&tag[..remove_start]);
        out.push(' ');
        out.push_str(&tag[remove_end..]);
        return out;
    }
    tag.to_string()
}

/// Finds the matching close for the element opened by `root` (assumed `<div`)
/// starting to scan at `content_start`. Returns the offset of the closing `>`
/// of `</div>`.
pub fn find_matching_close(html: &str, root: &TagSpan) -> Option<usize> {
    let bytes = html.as_bytes();
    let mut depth: usize = 1;
    let mut i = root.content_start;
    while i < bytes.len() {
        match bytes[i] {
            b'<' => {
                if html[i..].starts_with("<!--") {
                    i += html[i..].find("-->").map(|p| p + 3).unwrap_or(4);
                    continue;
                }
                if html[i..].starts_with("<div") || html[i..].starts_with("<DIV") {
                    let next = *bytes.get(i + 4).unwrap_or(&b'>');
                    if next.is_ascii_alphabetic()
                        || next == b'>'
                        || next == b' '
                        || next == b'\n'
                        || next == b'\t'
                        || next == b'\r'
                    {
                        depth += 1;
                    }
                } else if html[i..].starts_with("</div") || html[i..].starts_with("</DIV") {
                    depth -= 1;
                    if depth == 0 {
                        let close = html[i..].find('>')? + i;
                        return Some(close);
                    }
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_and_edits_attributes() {
        let html = r#"<div id="stage" data-composition-id="abc" data-duration="5"><p>hi</p></div>"#;
        let tag = find_tag_with_attr(html, "data-composition-id", Some("abc")).unwrap();
        assert_eq!(
            get_tag_attribute(&html[tag.range.clone()], "data-duration").unwrap(),
            "5"
        );

        let edited = set_tag_attribute(&html[tag.range.clone()], "data-width", "1280");
        assert!(edited.contains(r#"data-width="1280""#));

        let removed = remove_tag_attribute(&edited, "data-composition-id");
        assert!(!removed.contains("data-composition-id"));
    }

    #[test]
    fn finds_matching_close() {
        let html = "<div data-composition-id=\"a\"><div><p>x</p></div>y</div><span>after</span>";
        let root = find_tag_with_attr(html, "data-composition-id", None).unwrap();
        let close = find_matching_close(html, &root).unwrap();
        assert_eq!(close + 1, html.find("<span>").unwrap());
        assert_eq!(
            &html[root.content_start..close],
            "<div><p>x</p></div>y</div"
        );
    }
}
