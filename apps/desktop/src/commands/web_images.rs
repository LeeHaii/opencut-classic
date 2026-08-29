use base64::Engine as _;
use hyperframes::{composition_dirs_in, media_refs};
use reqwest::blocking::{Client, Response};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const COMMONS_API: &str = "https://commons.wikimedia.org/w/api.php";
const MAX_SEARCH_RESULTS: usize = 12;
const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
const MIN_IMAGE_WIDTH: u32 = 800;
const MAX_IMAGE_PIXELS: u64 = 100_000_000;
const SELECTED_IMAGE_PLACEHOLDER_PREFIX: &str = "opencut-selected-image://";
static SEARCH_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSearchRequest {
    pub project_id: String,
    pub element_id: String,
    pub user_prompt: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebImageCandidate {
    pub id: String,
    pub title: String,
    pub thumbnail_url: String,
    pub source_url: String,
    pub source_page_url: String,
    pub width: u32,
    pub height: u32,
    pub mime_type: String,
    pub author: String,
    pub license: String,
    pub attribution: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredSearch {
    search_id: String,
    query: String,
    candidates: Vec<WebImageCandidate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebImageSearchResult {
    search_id: String,
    query: String,
    candidates: Vec<WebImageCandidate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageIngestRequest {
    pub project_id: String,
    pub element_id: String,
    pub user_prompt: String,
    pub search_id: String,
    pub candidate_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentImageIngestRequest {
    pub project_id: String,
    pub element_id: String,
    pub user_prompt: String,
    pub data_url: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebImageAsset {
    id: String,
    name: String,
    data_url: String,
    internal_url: String,
    placeholder: String,
    source_page_url: String,
    width: u32,
    height: u32,
    mime_type: String,
    author: String,
    license: String,
    attribution: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveMediaRequest {
    pub project_id: String,
    pub element_id: String,
    pub html: String,
}

fn validate_ids(project_id: &str, element_id: &str) -> Result<(), String> {
    for id in [project_id, element_id] {
        if !crate::commands::valid_identifier(id) {
            return Err(format!("invalid identifier: {id}"));
        }
    }
    Ok(())
}

fn normalized_prompt(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn explicitly_denies_search(prompt: &str) -> bool {
    let lower = prompt.to_ascii_lowercase();
    [
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
    .any(|needle| lower.contains(needle))
}

fn explicitly_allows_search(prompt: &str) -> bool {
    if explicitly_denies_search(prompt) {
        return false;
    }
    let lower = normalized_prompt(prompt).to_ascii_lowercase();
    let image_word = ["image", "images", "photo", "photos", "picture", "pictures"]
        .iter()
        .any(|word| lower.contains(word));
    let search_word = ["search", "find", "look up", "source", "download"]
        .iter()
        .any(|word| lower.contains(word));
    let web_word = ["web", "online", "internet"]
        .iter()
        .any(|word| lower.contains(word));
    let use_from_web = web_word
        && ["use", "include", "add", "replace", "put", "place", "insert"]
            .iter()
            .any(|word| lower.contains(word));
    let real_image = [
        "real image",
        "real images",
        "actual image",
        "actual images",
        "real photo",
        "real photos",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase));
    image_word
        && (search_word
            || real_image
            || use_from_web
            || lower.contains("search images")
            || lower.contains("find photos"))
}

fn explicitly_uses_attachment(prompt: &str) -> bool {
    let lower = normalized_prompt(prompt).to_ascii_lowercase();
    if [
        "do not use the image",
        "don't use the image",
        "dont use the image",
        "do not use the attachment",
        "don't use the attachment",
        "do not use attached",
        "don't use attached",
        "dont use attached",
        "do not use the attached",
        "don't use the attached",
        "dont use the attached",
        "style reference",
        "visual reference",
        "as inspiration",
    ]
    .iter()
    .any(|phrase| lower.contains(phrase))
    {
        return false;
    }
    let action = [
        "use", "include", "add", "replace", "put", "place", "insert", "set", "show",
    ]
    .iter()
    .any(|word| {
        lower.split_whitespace().any(|token| {
            token.trim_matches(|character: char| !character.is_ascii_alphabetic()) == *word
        })
    });
    let media = [
        "image",
        "images",
        "photo",
        "photos",
        "picture",
        "pictures",
        "portrait",
        "attachment",
        "attached",
        "this image",
        "this photo",
        "this picture",
    ]
    .iter()
    .any(|word| lower.contains(word));
    action && media
}

fn derive_query(prompt: &str) -> String {
    let mut value = normalized_prompt(prompt);
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
        "up",
        "source",
        "use",
        "include",
        "add",
        "download",
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
        "video",
        "animation",
        "scene",
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

fn text_metadata(value: Option<&serde_json::Value>, fallback: &str) -> String {
    let raw = value
        .and_then(|item| item.get("value"))
        .and_then(|item| item.as_str())
        .unwrap_or(fallback);
    let mut output = String::with_capacity(raw.len());
    let mut inside_tag = false;
    for character in raw.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(character),
            _ => {}
        }
    }
    let trimmed = output.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed
    }
}

fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(20))
        .user_agent("OpenCut/1.0 (AI Motion image integration)")
        .build()
        .map_err(|error| format!("could not initialize image client: {error}"))
}

fn composition_root(
    app: &AppHandle,
    project_id: &str,
    element_id: &str,
) -> Result<PathBuf, String> {
    let projects_dir = crate::commands::settings::hyperframes_location(app)?;
    Ok(composition_dirs_in(&projects_dir, project_id, element_id).root)
}

fn search_id(query: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = SEARCH_COUNTER.fetch_add(1, Ordering::Relaxed);
    let digest = Sha256::digest(format!("{query}:{now}:{counter}").as_bytes());
    format!("search-{}", hex(&digest[..8]))
}

fn search_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !crate::commands::valid_identifier(id) {
        return Err("invalid image search id".to_string());
    }
    Ok(root.join(".media").join("search").join(id))
}

fn search_images_inner(
    app: AppHandle,
    request: ImageSearchRequest,
) -> Result<Option<WebImageSearchResult>, String> {
    validate_ids(&request.project_id, &request.element_id)?;
    if !explicitly_allows_search(&request.user_prompt) {
        return Ok(None);
    }
    let query = derive_query(&request.user_prompt);
    let limit = request.limit.unwrap_or(8).clamp(4, MAX_SEARCH_RESULTS);
    let mut api_url =
        reqwest::Url::parse(COMMONS_API).map_err(|_| "Wikimedia API URL is invalid".to_string())?;
    api_url
        .query_pairs_mut()
        .append_pair("action", "query")
        .append_pair("format", "json")
        .append_pair("formatversion", "2")
        .append_pair("generator", "search")
        .append_pair("gsrsearch", &format!("{query} filetype:bitmap"))
        .append_pair("gsrnamespace", "6")
        .append_pair("gsrlimit", "24")
        .append_pair("prop", "imageinfo")
        .append_pair("iiprop", "url|mime|size|extmetadata")
        .append_pair("iiurlwidth", "640")
        .append_pair("iiextmetadatalanguage", "en");
    let response = client()?
        .get(api_url)
        .send()
        .map_err(|error| format!("Wikimedia search failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Wikimedia search failed with HTTP {}",
            response.status()
        ));
    }
    let payload: serde_json::Value = response
        .json()
        .map_err(|error| format!("Wikimedia returned invalid search data: {error}"))?;
    let pages = payload
        .pointer("/query/pages")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut candidates = Vec::new();
    for page in pages {
        let Some(info) = page.pointer("/imageinfo/0") else {
            continue;
        };
        let mime = info
            .get("mime")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if mime != "image/jpeg" && mime != "image/png" {
            continue;
        }
        let width = info
            .get("width")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32;
        let height = info
            .get("height")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32;
        if width < MIN_IMAGE_WIDTH || height == 0 {
            continue;
        }
        let Some(source_url) = info.get("url").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(thumbnail_url) = info.get("thumburl").and_then(|value| value.as_str()) else {
            continue;
        };
        if assert_commons_url(source_url, "upload.wikimedia.org").is_err()
            || assert_commons_url(thumbnail_url, "upload.wikimedia.org").is_err()
        {
            continue;
        }
        let metadata = info.get("extmetadata");
        let title_fallback = page
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("Wikimedia Commons image")
            .trim_start_matches("File:");
        let title = text_metadata(
            metadata.and_then(|value| value.get("ImageDescription")),
            title_fallback,
        );
        let author = text_metadata(
            metadata.and_then(|value| value.get("Artist")),
            "Unknown creator",
        );
        let license = text_metadata(
            metadata.and_then(|value| value.get("LicenseShortName")),
            "See source page",
        );
        let page_id = page
            .get("pageid")
            .and_then(|value| value.as_u64())
            .unwrap_or(candidates.len() as u64);
        let source_page_url = info
            .get("descriptionurl")
            .and_then(|value| value.as_str())
            .unwrap_or("https://commons.wikimedia.org/")
            .to_string();
        candidates.push(WebImageCandidate {
            id: format!("commons-{page_id}"),
            title,
            thumbnail_url: thumbnail_url.to_string(),
            source_url: source_url.to_string(),
            source_page_url,
            width,
            height,
            mime_type: mime.to_string(),
            attribution: format!("{author} — {license}"),
            author,
            license,
        });
    }
    candidates.sort_by(|first, second| {
        let first_delta = ((first.width as f64 / first.height as f64) - 16.0 / 9.0).abs();
        let second_delta = ((second.width as f64 / second.height as f64) - 16.0 / 9.0).abs();
        first_delta.total_cmp(&second_delta)
    });
    candidates.truncate(limit);
    if candidates.is_empty() {
        return Err(format!(
            "No suitable Wikimedia Commons images were found for “{query}”."
        ));
    }
    let id = search_id(&query);
    let root = composition_root(&app, &request.project_id, &request.element_id)?;
    let directory = search_dir(&root, &id)?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create image search directory: {error}"))?;
    let stored = StoredSearch {
        search_id: id.clone(),
        query: query.clone(),
        candidates: candidates.clone(),
    };
    std::fs::write(
        directory.join("candidates.json"),
        serde_json::to_vec_pretty(&stored).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("could not save image candidates: {error}"))?;
    Ok(Some(WebImageSearchResult {
        search_id: id,
        query,
        candidates,
    }))
}

#[tauri::command]
pub async fn hf_image_search(
    app: AppHandle,
    request: ImageSearchRequest,
) -> Result<Option<WebImageSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || search_images_inner(app, request))
        .await
        .map_err(|error| format!("image search task failed: {error}"))?
}

fn assert_commons_url(value: &str, host: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "image URL is invalid".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some(host)
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("image URL is not an allowed Wikimedia URL".to_string());
    }
    Ok(url)
}

fn read_limited(response: Response) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!(
            "image download failed with HTTP {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_IMAGE_BYTES as u64)
    {
        return Err("image exceeds the download size limit".to_string());
    }
    let mut bytes = Vec::new();
    response
        .take((MAX_IMAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("image download failed: {error}"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("image exceeds the download size limit".to_string());
    }
    Ok(bytes)
}

fn sniff_image(bytes: &[u8]) -> Result<(&'static str, &'static str, u32, u32), String> {
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        validate_dimensions(width, height)?;
        return Ok(("image/png", "png", width, height));
    }
    if bytes.len() >= 4 && bytes[0..2] == [0xff, 0xd8] {
        let mut offset = 2usize;
        while offset + 9 < bytes.len() {
            if bytes[offset] != 0xff {
                offset += 1;
                continue;
            }
            let marker = bytes[offset + 1];
            offset += 2;
            if marker == 0xd8 || marker == 0xd9 {
                continue;
            }
            if offset + 2 > bytes.len() {
                break;
            }
            let length = u16::from_be_bytes([bytes[offset], bytes[offset + 1]]) as usize;
            if length < 2 || offset + length > bytes.len() {
                break;
            }
            if matches!(
                marker,
                0xc0 | 0xc1
                    | 0xc2
                    | 0xc3
                    | 0xc5
                    | 0xc6
                    | 0xc7
                    | 0xc9
                    | 0xca
                    | 0xcb
                    | 0xcd
                    | 0xce
                    | 0xcf
            ) && length >= 7
            {
                let height = u16::from_be_bytes([bytes[offset + 3], bytes[offset + 4]]) as u32;
                let width = u16::from_be_bytes([bytes[offset + 5], bytes[offset + 6]]) as u32;
                validate_dimensions(width, height)?;
                return Ok(("image/jpeg", "jpg", width, height));
            }
            offset += length;
        }
    }
    Err("downloaded file is not a supported PNG or JPEG image".to_string())
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS {
        return Err(format!(
            "image dimensions {width}x{height} are outside the supported range"
        ));
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

struct FrozenImageMetadata {
    provider: &'static str,
    name: String,
    source_page_url: String,
    source_image_url: Option<String>,
    author: String,
    license: String,
    attribution: String,
    query: Option<String>,
}

fn freeze_image(
    root: &Path,
    bytes: &[u8],
    metadata: FrozenImageMetadata,
) -> Result<WebImageAsset, String> {
    let (mime_type, extension, width, height) = sniff_image(bytes)?;
    let digest = Sha256::digest(bytes);
    let sha256 = hex(&digest);
    let id = format!("image-{}", &sha256[..12]);
    let directory = root.join(".media").join("images");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create image directory: {error}"))?;
    let path = directory.join(format!("{id}.{extension}"));
    std::fs::write(&path, bytes)
        .map_err(|error| format!("could not freeze selected image: {error}"))?;
    let record = serde_json::json!({
        "id": id, "type": "image", "provider": metadata.provider, "query": metadata.query,
        "path": path.to_string_lossy(), "sourcePage": metadata.source_page_url,
        "sourceImage": metadata.source_image_url, "author": metadata.author,
        "license": metadata.license, "attribution": metadata.attribution,
        "width": width, "height": height, "mimeType": mime_type, "sha256": sha256,
    });
    let manifest_path = root.join(".media").join("manifest.json");
    let mut manifest = std::fs::read(&manifest_path)
        .ok()
        .and_then(|value| serde_json::from_slice::<serde_json::Value>(&value).ok())
        .unwrap_or_else(|| serde_json::json!({ "version": 1, "assets": [] }));
    if let Some(assets) = manifest
        .get_mut("assets")
        .and_then(|value| value.as_array_mut())
    {
        assets
            .retain(|asset| asset.get("sha256").and_then(|value| value.as_str()) != Some(&sha256));
        assets.push(record);
    }
    std::fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("could not save image provenance: {error}"))?;
    let placeholder = format!("{SELECTED_IMAGE_PLACEHOLDER_PREFIX}{}", &sha256[..12]);
    Ok(WebImageAsset {
        id,
        name: metadata.name,
        data_url: format!(
            "data:{mime_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ),
        internal_url: media_refs::internal_url_for(&path),
        placeholder,
        source_page_url: metadata.source_page_url,
        width,
        height,
        mime_type: mime_type.to_string(),
        author: metadata.author,
        license: metadata.license,
        attribution: metadata.attribution,
        sha256,
    })
}

fn decode_image_data_url(value: &str) -> Result<Vec<u8>, String> {
    let (metadata, encoded) = value
        .split_once(',')
        .ok_or_else(|| "attached image is not a valid data URL".to_string())?;
    if !metadata.starts_with("data:image/") || !metadata.ends_with(";base64") {
        return Err("attached image must be a base64 image data URL".to_string());
    }
    if encoded.len() > (MAX_IMAGE_BYTES * 4 / 3) + 8 {
        return Err("attached image exceeds the size limit".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "attached image contains invalid base64 data".to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("attached image exceeds the size limit".to_string());
    }
    Ok(bytes)
}

fn ingest_image_inner(
    app: AppHandle,
    request: ImageIngestRequest,
) -> Result<WebImageAsset, String> {
    validate_ids(&request.project_id, &request.element_id)?;
    if !explicitly_allows_search(&request.user_prompt) {
        return Err("web image search was not explicitly authorized in this request".to_string());
    }
    let root = composition_root(&app, &request.project_id, &request.element_id)?;
    let stored_path = search_dir(&root, &request.search_id)?.join("candidates.json");
    let stored: StoredSearch = serde_json::from_slice(
        &std::fs::read(stored_path).map_err(|_| "saved image search was not found".to_string())?,
    )
    .map_err(|_| "saved image search is invalid".to_string())?;
    if stored.search_id != request.search_id {
        return Err("saved image search does not match".to_string());
    }
    let candidate = stored
        .candidates
        .into_iter()
        .find(|item| item.id == request.candidate_id)
        .ok_or("selected image candidate does not exist")?;
    let url = assert_commons_url(&candidate.source_url, "upload.wikimedia.org")?;
    let bytes = read_limited(
        client()?
            .get(url)
            .send()
            .map_err(|error| format!("image download failed: {error}"))?,
    )?;
    let (mime_type, _, _, _) = sniff_image(&bytes)?;
    if candidate.mime_type != mime_type {
        return Err("downloaded image type does not match the search result".to_string());
    }
    freeze_image(
        &root,
        &bytes,
        FrozenImageMetadata {
            provider: "wikimedia-commons",
            name: candidate.title,
            source_page_url: candidate.source_page_url,
            source_image_url: Some(candidate.source_url),
            author: candidate.author,
            license: candidate.license,
            attribution: candidate.attribution,
            query: Some(stored.query),
        },
    )
}

#[tauri::command]
pub async fn hf_image_ingest(
    app: AppHandle,
    request: ImageIngestRequest,
) -> Result<WebImageAsset, String> {
    tauri::async_runtime::spawn_blocking(move || ingest_image_inner(app, request))
        .await
        .map_err(|error| format!("image ingest task failed: {error}"))?
}

fn ingest_attachment_inner(
    app: AppHandle,
    request: AttachmentImageIngestRequest,
) -> Result<Option<WebImageAsset>, String> {
    validate_ids(&request.project_id, &request.element_id)?;
    if !explicitly_uses_attachment(&request.user_prompt) {
        return Ok(None);
    }
    let bytes = decode_image_data_url(&request.data_url)?;
    let root = composition_root(&app, &request.project_id, &request.element_id)?;
    freeze_image(
        &root,
        &bytes,
        FrozenImageMetadata {
            provider: "user-upload",
            name: request
                .name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| "Attached image".to_string()),
            source_page_url: String::new(),
            source_image_url: None,
            author: "User provided".to_string(),
            license: "User-provided media".to_string(),
            attribution: "Provided by the user".to_string(),
            query: None,
        },
    )
    .map(Some)
}

#[tauri::command]
pub async fn hf_image_ingest_attachment(
    app: AppHandle,
    request: AttachmentImageIngestRequest,
) -> Result<Option<WebImageAsset>, String> {
    tauri::async_runtime::spawn_blocking(move || ingest_attachment_inner(app, request))
        .await
        .map_err(|error| format!("attachment ingest task failed: {error}"))?
}

fn path_from_internal_url(value: &str) -> Option<PathBuf> {
    let prefix = "opencut-media://local/";
    let encoded = value.strip_prefix(prefix)?;
    let mut bytes = Vec::with_capacity(encoded.len());
    let raw = encoded.as_bytes();
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%' && index + 2 < raw.len() {
            if let Ok(byte) = u8::from_str_radix(&encoded[index + 1..index + 3], 16) {
                bytes.push(byte);
                index += 3;
                continue;
            }
        }
        bytes.push(raw[index]);
        index += 1;
    }
    Some(PathBuf::from(String::from_utf8_lossy(&bytes).into_owned()))
}

fn resolve_media_inner(app: AppHandle, request: ResolveMediaRequest) -> Result<String, String> {
    validate_ids(&request.project_id, &request.element_id)?;
    let root = composition_root(&app, &request.project_id, &request.element_id)?;
    let allowed = root
        .join(".media")
        .join("images")
        .canonicalize()
        .unwrap_or_else(|_| root.join(".media").join("images"));
    let prefix = "opencut-media://local/";
    let mut html = request.html;
    let mut cursor = 0usize;
    while let Some(relative) = html[cursor..].find(prefix) {
        let start = cursor + relative;
        let end = html[start..]
            .find(|character: char| {
                character == '\"'
                    || character == '\''
                    || character == ')'
                    || character.is_whitespace()
            })
            .map(|offset| start + offset)
            .unwrap_or(html.len());
        let url = html[start..end].to_string();
        let Some(path) = path_from_internal_url(&url) else {
            cursor = end;
            continue;
        };
        let canonical = path
            .canonicalize()
            .map_err(|_| "local image referenced by the composition is missing".to_string())?;
        if !canonical.starts_with(&allowed) {
            return Err(
                "composition media reference is outside its local image directory".to_string(),
            );
        }
        let bytes = std::fs::read(&canonical)
            .map_err(|error| format!("could not read local image: {error}"))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err("local image exceeds the preview size limit".to_string());
        }
        let (mime, _, _, _) = sniff_image(&bytes)?;
        let data_url = format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        html.replace_range(start..end, &data_url);
        cursor = start + data_url.len();
    }
    Ok(html)
}

#[tauri::command]
pub async fn hf_media_resolve(
    app: AppHandle,
    request: ResolveMediaRequest,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_media_inner(app, request))
        .await
        .map_err(|error| format!("media resolve task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_search_requires_explicit_permission() {
        for prompt in [
            "Search the web for images of Mount Fuji",
            "Search online for images of Tokyo",
            "Use a real photo of Tokyo",
            "Find real photos of SpaceX launches",
            "Search for suitable photos where useful",
            "elon musk image from the web to replace the middle image",
        ] {
            assert!(explicitly_allows_search(prompt), "{prompt}");
        }
        for prompt in [
            "Make a cinematic Tokyo animation",
            "Use cinematic photography style",
            "Show a real person in a cinematic location",
            "Use photos but do not search the web",
        ] {
            assert!(!explicitly_allows_search(prompt), "{prompt}");
        }
    }

    #[test]
    fn derives_a_bounded_subject_query() {
        assert_eq!(
            derive_query("Search the web for images of Mount Fuji."),
            "Mount Fuji"
        );
        assert_eq!(derive_query("Use a real photo of Tokyo online."), "Tokyo");
        assert_eq!(
            derive_query("Make a video about Mount Everest and use real photos from the web."),
            "Mount Everest"
        );
        assert_eq!(
            derive_query("Search for suitable photos where useful."),
            "editorial photography"
        );
        assert_eq!(
            derive_query("elon musk image from the web to replace the middle image"),
            "elon musk"
        );
    }

    #[test]
    fn attachment_use_requires_explicit_media_intent() {
        for prompt in [
            "replace image in the center with this elon image",
            "Use the attached photo as the background",
            "put this portrait in the circle",
        ] {
            assert!(explicitly_uses_attachment(prompt), "{prompt}");
        }
        for prompt in [
            "make it feel cinematic",
            "use this image as a style reference",
            "use the attached picture as inspiration",
            "do not use the attached image",
        ] {
            assert!(!explicitly_uses_attachment(prompt), "{prompt}");
        }
    }

    #[test]
    fn decodes_and_validates_attached_png_data() {
        let bytes = decode_image_data_url(
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        )
        .unwrap();
        assert_eq!(sniff_image(&bytes).unwrap(), ("image/png", "png", 1, 1));
        assert!(decode_image_data_url("data:text/plain;base64,SGVsbG8=").is_err());
    }
}
