#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebImageIntent {
    Requested,
    NotRequested,
    Denied,
}

fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn contains_token(value: &str, candidates: &[&str]) -> bool {
    value.split_whitespace().any(|token| {
        let token = token.trim_matches(|character: char| !character.is_ascii_alphabetic());
        candidates.contains(&token)
    })
}

pub fn classify_web_image_intent(prompt: &str) -> WebImageIntent {
    let lower = normalize(prompt).to_ascii_lowercase();
    if [
        "do not search",
        "don't search",
        "dont search",
        "never search",
        "no web image",
        "no online image",
        "without web image",
        "without online image",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
    {
        return WebImageIntent::Denied;
    }

    let mentions_image = contains_token(
        &lower,
        &[
            "image",
            "images",
            "photo",
            "photos",
            "picture",
            "pictures",
            "portrait",
            "portraits",
            "avatar",
            "avatars",
        ],
    );
    let mentions_web = contains_token(&lower, &["web", "online", "internet"]);
    let requests_search = contains_token(
        &lower,
        &["search", "find", "source", "download", "browse", "lookup"],
    ) || lower.contains("look up");
    let requests_real_image = [
        "real image",
        "real images",
        "actual image",
        "actual images",
        "real photo",
        "real photos",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase));

    if mentions_image && (mentions_web || requests_search || requests_real_image) {
        WebImageIntent::Requested
    } else {
        WebImageIntent::NotRequested
    }
}

pub fn derive_web_image_query(prompt: &str) -> String {
    let mut value = normalize(prompt);
    let lower = value.to_ascii_lowercase();
    for marker in [
        "video about ",
        "animation about ",
        "scene about ",
        "story about ",
    ] {
        if let Some(index) = lower.find(marker) {
            value = value[index + marker.len()..].to_string();
            if let Some(end) = value.to_ascii_lowercase().find(" and ") {
                value.truncate(end);
            }
            break;
        }
    }

    let lower = value.to_ascii_lowercase();
    for marker in [
        "images of ",
        "image of ",
        "photos of ",
        "photo of ",
        "pictures of ",
        "picture of ",
        "portrait of ",
    ] {
        if let Some(index) = lower.find(marker) {
            value = value[index + marker.len()..].to_string();
            break;
        }
    }

    for ending in [
        " from the web",
        " from web",
        " online",
        " on the internet",
        " from the internet",
    ] {
        if let Some(index) = value.to_ascii_lowercase().find(ending) {
            value.truncate(index);
        }
    }

    let cleaned = value
        .trim_matches(|character: char| character.is_whitespace() || ".,;:!?-".contains(character))
        .trim();
    let generic_words = [
        "search",
        "find",
        "look",
        "lookup",
        "up",
        "source",
        "use",
        "include",
        "add",
        "download",
        "replace",
        "change",
        "update",
        "swap",
        "put",
        "place",
        "insert",
        "set",
        "show",
        "web",
        "online",
        "internet",
        "real",
        "actual",
        "suitable",
        "image",
        "images",
        "photo",
        "photos",
        "picture",
        "pictures",
        "portrait",
        "portraits",
        "avatar",
        "avatars",
        "from",
        "on",
        "for",
        "where",
        "when",
        "useful",
        "the",
        "this",
        "an",
        "a",
        "to",
        "with",
        "into",
        "video",
        "animation",
        "scene",
        "middle",
        "center",
        "central",
        "circle",
    ];
    let concise = cleaned
        .split_whitespace()
        .filter(|word| {
            let normalized = word
                .trim_matches(|character: char| ".,;:!?-".contains(character))
                .to_ascii_lowercase();
            !generic_words.contains(&normalized.as_str())
        })
        .collect::<Vec<_>>()
        .join(" ");
    if concise.is_empty() {
        "editorial photography".to_string()
    } else {
        concise.chars().take(160).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_natural_web_image_requests() {
        for prompt in [
            "Search the web for images of Mount Fuji",
            "Use a real photo of Tokyo",
            "elon musk image from the web to update the image in the circle in the center",
            "change the avatar to a portrait of Grace Hopper from the internet",
            "swap the middle picture with an Ada Lovelace image online",
        ] {
            assert_eq!(
                classify_web_image_intent(prompt),
                WebImageIntent::Requested,
                "{prompt}"
            );
        }
    }

    #[test]
    fn respects_denials_and_ordinary_motion_requests() {
        for prompt in [
            "Use photos but do not search the web",
            "no online image; keep the current illustration",
        ] {
            assert_eq!(
                classify_web_image_intent(prompt),
                WebImageIntent::Denied,
                "{prompt}"
            );
        }
        assert_eq!(
            classify_web_image_intent("Make the circle pulse faster"),
            WebImageIntent::NotRequested
        );
    }

    #[test]
    fn derives_subject_from_update_language() {
        assert_eq!(
            derive_web_image_query(
                "elon musk image from the web to update the image in the circle in the center"
            ),
            "elon musk"
        );
        assert_eq!(
            derive_web_image_query("Search the web for images of Mount Fuji."),
            "Mount Fuji"
        );
    }
}
