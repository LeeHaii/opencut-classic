pub mod agy;
pub mod composition;
pub mod image_intent;
pub mod layout;
pub mod media_refs;
pub mod media_replace;
mod scan;

pub use composition::{
    AppendError, AppendOutcome, CompositionInfo, SeedSpec, append_child_to_master, extract_html,
    new_master_document, normalize_child, seed_composition, validate_composition,
};
pub use image_intent::{WebImageIntent, classify_web_image_intent, derive_web_image_query};
pub use layout::{
    CompositionDirs, composition_dirs, composition_dirs_in, valid_identifier, write_atomic,
};
pub use media_refs::{internal_url_for, rewrite_to_portable};
pub use media_replace::{ImageFit, ReplaceImageOutcome, VisualTarget, replace_visual_with_image};
