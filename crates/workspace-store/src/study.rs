use crate::{
    error::{Error, Result},
    records::Patch,
};
use chrono::DateTime;
use rusqlite::Transaction;

/// Keep the reader gate monotonic even after a later legacy collection or card save.
pub fn needs_p6(patch: &Patch) -> bool {
    if matches!(
        patch.store.as_str(),
        "studySettings" | "studyEvents" | "studyActivity" | "fsrsModels"
    ) {
        return true;
    }
    let Some(value) = &patch.value else {
        return false;
    };
    !value["studyPriority"].is_null()
        || !value["activeFsrsModelId"].is_null()
        || (patch.store == "practices" && !value["studyDay"].is_null())
        || (patch.store == "sources"
            && (value["readingIntervalDays"]
                .as_u64()
                .is_some_and(|days| ![1, 3, 7, 14, 30].contains(&days))
                || value["adaptiveReading"]["intervalDays"]
                    .as_u64()
                    .is_some_and(|days| days > 365)
                || value["adaptiveReading"]["factor"]
                    .as_f64()
                    .is_some_and(|factor| !(1.3..=3.0).contains(&factor))))
}

/// Zod refinements are not represented in the exported JSON Schema.
pub fn validate(patch: &Patch) -> Result<()> {
    let Some(value) = &patch.value else {
        return Ok(());
    };
    match patch.store.as_str() {
        "studySettings" => {
            if value["readingGrowthMin"].as_f64().unwrap_or(1.3)
                > value["readingGrowthMax"].as_f64().unwrap_or(3.0)
                || value["readingInitialDays"].as_u64().unwrap_or(1)
                    > value["readingMaxDays"].as_u64().unwrap_or(365)
            {
                return Err(Error::invalid());
            }
        }
        "studyActivity" => {
            let start = DateTime::parse_from_rfc3339(value["startedAt"].as_str().unwrap_or(""))
                .map_err(|_| Error::invalid())?;
            let end = DateTime::parse_from_rfc3339(value["endedAt"].as_str().unwrap_or(""))
                .map_err(|_| Error::invalid())?;
            let duration = end.signed_duration_since(start).num_milliseconds();
            if duration < 0
                || value["activeMs"]
                    .as_u64()
                    .is_none_or(|active| active > duration as u64)
            {
                return Err(Error::invalid());
            }
        }
        _ => {}
    }
    Ok(())
}

/// Historical model scopes and event references may outlive deleted decks/cards/sources.
/// Only live selections must resolve; changing/deleting a selected model is atomic with
/// clearing or replacing its selectors in the same transaction.
pub fn validate_model_selections(tx: &Transaction<'_>) -> Result<()> {
    let invalid: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM studySettings s LEFT JOIN fsrsModels m ON m.id=json_extract(s.data,'$.activeFsrsModelId') WHERE json_extract(s.data,'$.activeFsrsModelId') IS NOT NULL AND (m.id IS NULL OR json_extract(m.data,'$.deckId') IS NOT NULL)) OR EXISTS(SELECT 1 FROM decks d LEFT JOIN fsrsModels m ON m.id=json_extract(d.data,'$.activeFsrsModelId') WHERE json_extract(d.data,'$.activeFsrsModelId') IS NOT NULL AND (m.id IS NULL OR json_extract(m.data,'$.deckId') IS NULL OR json_extract(m.data,'$.deckId')<>d.id))",
        [], |row| row.get(0),
    )?;
    if invalid {
        Err(Error::invalid())
    } else {
        Ok(())
    }
}
