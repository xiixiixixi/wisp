use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::command;

const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyEntry {
    pub date: String,
    pub weather_code: i64,
    pub temp_max: f64,
    pub temp_min: f64,
    pub precipitation_probability: i64,
    pub sunrise: String,
    pub sunset: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherReport {
    pub latitude: f64,
    pub longitude: f64,
    pub temperature: f64,
    pub apparent_temperature: f64,
    pub humidity: i64,
    pub weather_code: i64,
    pub is_day: bool,
    pub wind_speed: f64,
    pub wind_direction: i64,
    pub updated_at: i64,
    pub daily: Vec<DailyEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeoPlace {
    pub name: String,
    pub country: String,
    pub admin1: String,
    pub latitude: f64,
    pub longitude: f64,
}

struct CacheEntry {
    report: WeatherReport,
    fetched_at: Instant,
}

static WEATHER_CACHE: Mutex<Option<HashMap<(i64, i64), CacheEntry>>> = Mutex::new(None);
const CACHE_TTL: Duration = Duration::from_secs(15 * 60);

fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .header("User-Agent", "wisp-file-explorer")
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())
}

/// Current conditions + a 3-day outlook from open-meteo (keyless), cached
/// for 15 minutes per rounded coordinate so the dashboard can poll freely.
#[command]
pub async fn get_weather(latitude: f64, longitude: f64) -> Result<WeatherReport, String> {
    // Round to ~1km so cache hits survive tiny coordinate drift.
    let key = ((latitude * 100.0).round() as i64, (longitude * 100.0).round() as i64);

    if let Ok(guard) = WEATHER_CACHE.lock() {
        if let Some(map) = guard.as_ref() {
            if let Some(entry) = map.get(&key) {
                if entry.fetched_at.elapsed() < CACHE_TTL {
                    return Ok(entry.report.clone());
                }
            }
        }
    }

    let url = format!(
        "{}?latitude={}&longitude={}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&forecast_days=4&timezone=auto",
        FORECAST_URL, key.0 as f64 / 100.0, key.1 as f64 / 100.0
    );

    let json = tokio::task::spawn_blocking(move || fetch_json(&url))
        .await
        .map_err(|e| e.to_string())??;

    let current = json
        .get("current")
        .ok_or_else(|| "open-meteo response missing 'current'".to_string())?;
    let daily = json
        .get("daily")
        .ok_or_else(|| "open-meteo response missing 'daily'".to_string())?;

    let parse_array = |key: &str| -> Result<Vec<serde_json::Value>, String> {
        daily
            .get(key)
            .and_then(|v| v.as_array())
            .cloned()
            .ok_or_else(|| format!("daily array '{}' missing", key))
    };
    let dates = parse_array("time")?;
    let codes = parse_array("weather_code")?;
    let tmax = parse_array("temperature_2m_max")?;
    let tmin = parse_array("temperature_2m_min")?;
    let precip = parse_array("precipitation_probability_max")?;
    let sunrise = parse_array("sunrise")?;
    let sunset = parse_array("sunset")?;

    let mut daily_entries = Vec::new();
    for i in 0..dates.len() {
        daily_entries.push(DailyEntry {
            date: dates[i].as_str().unwrap_or_default().to_string(),
            weather_code: codes.get(i).and_then(|v| v.as_i64()).unwrap_or(0),
            temp_max: tmax.get(i).and_then(|v| v.as_f64()).unwrap_or(0.0),
            temp_min: tmin.get(i).and_then(|v| v.as_f64()).unwrap_or(0.0),
            precipitation_probability: precip.get(i).and_then(|v| v.as_i64()).unwrap_or(0),
            sunrise: sunrise.get(i).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            sunset: sunset.get(i).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        });
    }

    let report = WeatherReport {
        latitude: current.get("latitude").and_then(|v| v.as_f64()).unwrap_or(latitude),
        longitude: current.get("longitude").and_then(|v| v.as_f64()).unwrap_or(longitude),
        temperature: current.get("temperature_2m").and_then(|v| v.as_f64()).unwrap_or(0.0),
        apparent_temperature: current
            .get("apparent_temperature")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        humidity: current
            .get("relative_humidity_2m")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        weather_code: current.get("weather_code").and_then(|v| v.as_i64()).unwrap_or(0),
        is_day: current.get("is_day").and_then(|v| v.as_i64()).unwrap_or(1) == 1,
        wind_speed: current.get("wind_speed_10m").and_then(|v| v.as_f64()).unwrap_or(0.0),
        wind_direction: current
            .get("wind_direction_10m")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        updated_at: chrono::Utc::now().timestamp(),
        daily: daily_entries,
    };

    if let Ok(mut guard) = WEATHER_CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(key, CacheEntry { report: report.clone(), fetched_at: Instant::now() });
        // Keep the cache bounded.
        if map.len() > 16 {
            map.clear();
        }
    }

    Ok(report)
}

/// City name → coordinates via the open-meteo geocoder (keyless).
#[command]
pub async fn geocode_city(name: String) -> Result<Vec<GeoPlace>, String> {
    let url = format!(
        "{}?name={}&count=5&language=zh&format=json",
        GEOCODE_URL,
        urlencoding::encode(&name)
    );
    let json = tokio::task::spawn_blocking(move || fetch_json(&url))
        .await
        .map_err(|e| e.to_string())??;

    let results = json
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let places = results
        .iter()
        .map(|r| GeoPlace {
            name: r.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            country: r.get("country").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            admin1: r.get("admin1").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            latitude: r.get("latitude").and_then(|v| v.as_f64()).unwrap_or(0.0),
            longitude: r.get("longitude").and_then(|v| v.as_f64()).unwrap_or(0.0),
        })
        .collect();

    Ok(places)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_roundtrip() {
        // Exercises the static-cache plumbing without touching the network.
        let key = (3123, 12147);
        let report = WeatherReport {
            latitude: 31.23,
            longitude: 121.47,
            temperature: 27.2,
            apparent_temperature: 31.0,
            humidity: 89,
            weather_code: 1,
            is_day: true,
            wind_speed: 8.5,
            wind_direction: 45,
            updated_at: 0,
            daily: vec![],
        };
        {
            let mut guard = WEATHER_CACHE.lock().unwrap();
            guard
                .get_or_insert_with(HashMap::new)
                .insert(key, CacheEntry { report: report.clone(), fetched_at: Instant::now() });
        }
        let guard = WEATHER_CACHE.lock().unwrap();
        let cached = guard.as_ref().unwrap().get(&key).unwrap();
        assert_eq!(cached.report.temperature, 27.2);
        guard.as_ref().unwrap().clear();
    }
}
