use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrderReportFile {
    file_name: String,
    content_base64: String,
}

fn is_monthly_workbook_name(file_name: &str) -> bool {
    let Some(stem) = file_name.strip_suffix(".xlsx") else {
        return false;
    };
    let Some((month, year)) = stem.split_once(' ') else {
        return false;
    };

    matches!(
        month,
        "January"
            | "February"
            | "March"
            | "April"
            | "May"
            | "June"
            | "July"
            | "August"
            | "September"
            | "October"
            | "November"
            | "December"
    ) && year.len() == 4
        && year.bytes().all(|character| character.is_ascii_digit())
}

fn write_report_without_overwrite(
    directory: &Path,
    file_name: &str,
    content: &[u8],
) -> Result<PathBuf, String> {
    let stem = file_name
        .strip_suffix(".xlsx")
        .ok_or_else(|| "The monthly workbook extension is invalid.".to_string())?;

    for suffix in 1..=1000 {
        let candidate_name = if suffix == 1 {
            file_name.to_string()
        } else {
            format!("{stem} ({suffix}).xlsx")
        };
        let candidate_path = directory.join(&candidate_name);
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("Unable to save {candidate_name}: {error}"));
            }
        };

        if let Err(error) = file.write_all(content) {
            drop(file);
            let _ = fs::remove_file(&candidate_path);
            return Err(format!("Unable to save {candidate_name}: {error}"));
        }
        return Ok(candidate_path);
    }

    Err(format!(
        "Unable to save {file_name}: too many files already use this monthly report name."
    ))
}

#[tauri::command(rename_all = "camelCase")]
fn save_order_reports(
    folder_path: String,
    reports: Vec<OrderReportFile>,
) -> Result<Vec<String>, String> {
    let selected_directory = Path::new(&folder_path);
    if !selected_directory.is_absolute() || !selected_directory.is_dir() {
        return Err("The selected Excel save location is not an available folder.".into());
    }
    let directory = selected_directory
        .canonicalize()
        .map_err(|error| format!("Unable to access the selected Excel folder: {error}"))?;

    let reports = reports
        .into_iter()
        .map(|report| {
            if !is_monthly_workbook_name(&report.file_name) {
                return Err("The server returned an invalid monthly workbook name.".to_string());
            }

            let content = STANDARD
                .decode(report.content_base64)
                .map_err(|error| format!("Unable to decode {}: {error}", report.file_name))?;
            if content.is_empty() {
                return Err(format!(
                    "The generated workbook {} is empty.",
                    report.file_name
                ));
            }
            Ok((report.file_name, content))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let mut saved_files = Vec::with_capacity(reports.len());
    for (file_name, content) in reports {
        let file_path = write_report_without_overwrite(&directory, &file_name, &content)?;
        let saved_path = file_path
            .canonicalize()
            .map_err(|error| format!("Unable to verify {file_name}: {error}"))?;
        let metadata = std::fs::metadata(&saved_path)
            .map_err(|error| format!("Unable to verify {file_name}: {error}"))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(format!(
                "The workbook {file_name} was not written as a non-empty file."
            ));
        }
        saved_files.push(saved_path.to_string_lossy().into_owned());
    }

    Ok(saved_files)
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, save_order_reports])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn saves_monthly_workbooks_to_the_selected_directory() {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let (directory, remove_directory) = if let Some(selected_directory) =
            std::env::var_os("BIGBITES_REPORT_TEST_DIRECTORY")
        {
            (PathBuf::from(selected_directory), false)
        } else {
            let directory = std::env::temp_dir().join(format!(
                "big-bites-reports-{}-{unique_id}",
                std::process::id()
            ));
            std::fs::create_dir(&directory).expect("temporary report directory should be created");
            (directory, true)
        };
        let year = (1000..=9999)
            .rev()
            .find(|year| !directory.join(format!("January {year}.xlsx")).exists())
            .expect("a free monthly workbook name should be available");
        let file_name = format!("January {year}.xlsx");
        let expected_content = std::env::var("BIGBITES_REPORT_TEST_CONTENT_BASE64")
            .map(|content| {
                STANDARD
                    .decode(content)
                    .expect("provided workbook fixture should be valid base64")
            })
            .unwrap_or_else(|_| b"test workbook bytes".to_vec());
        let reports: Vec<OrderReportFile> = serde_json::from_value(serde_json::json!([{
            "fileName": file_name,
            "contentBase64": STANDARD.encode(&expected_content),
        }]))
        .expect("frontend workbook payload should deserialize");

        let saved_paths = save_order_reports(directory.to_string_lossy().into_owned(), reports)
            .expect("workbook should be saved");
        let saved_path = Path::new(&saved_paths[0]);

        assert_eq!(
            saved_path.parent(),
            directory.canonicalize().ok().as_deref()
        );
        assert_eq!(
            std::fs::read(saved_path).expect("saved workbook should be readable"),
            expected_content,
        );

        if std::env::var_os("BIGBITES_REPORT_TEST_KEEP_FILE").is_none() {
            std::fs::remove_file(saved_path).expect("saved workbook should be removed");
        }
        if remove_directory {
            std::fs::remove_dir(directory).expect("temporary report directory should be removed");
        }
    }

    #[test]
    fn preserves_existing_monthly_workbooks_and_saves_a_numbered_copy() {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "big-bites-report-conflict-{}-{unique_id}",
            std::process::id()
        ));
        std::fs::create_dir(&directory).expect("temporary report directory should be created");
        let file_name = "January 2026.xlsx";
        let original_content = b"existing report";
        std::fs::write(directory.join(file_name), original_content)
            .expect("existing report fixture should be written");

        let saved_path = write_report_without_overwrite(&directory, file_name, b"new report")
            .expect("new report should use an available numbered filename");

        assert_eq!(
            saved_path.file_name().and_then(|name| name.to_str()),
            Some("January 2026 (2).xlsx")
        );
        assert_eq!(
            std::fs::read(directory.join(file_name)).expect("original report should remain"),
            original_content
        );
        assert_eq!(
            std::fs::read(&saved_path).expect("numbered report should be readable"),
            b"new report"
        );

        std::fs::remove_dir_all(directory).expect("temporary report directory should be removed");
    }
}
