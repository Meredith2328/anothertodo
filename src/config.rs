use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub fn path(dir: &Path) -> PathBuf {
    dir.join("config.toml")
}

pub fn load(dir: &Path) -> toml::Value {
    let path = path(dir);
    if !path.exists() {
        let _ = fs::write(&path, "[priority]\nmode=\"levels\"\nlevels=[\"低\",\"中\",\"高\"]\n[watch]\ninterval_seconds=30\n");
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or_else(|| toml::Value::Table(Default::default()))
}

pub fn levels(dir: &Path) -> Vec<String> {
    load(dir)
        .get("priority")
        .and_then(|v| v.get("levels"))
        .and_then(toml::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(toml::Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .filter(|values: &Vec<String>| !values.is_empty())
        .unwrap_or_else(crate::priority::levels)
}

pub fn set(dir: &Path, dotted: &str, raw: &str) -> io::Result<()> {
    let mut value = load(dir);
    let parts: Vec<_> = dotted.split('.').filter(|part| !part.is_empty()).collect();
    if parts.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "配置键不能为空",
        ));
    }
    let parsed = raw
        .parse::<bool>()
        .map(toml::Value::Boolean)
        .or_else(|_| raw.parse::<i64>().map(toml::Value::Integer))
        .unwrap_or_else(|_| toml::Value::String(raw.to_owned()));
    let mut current = &mut value;
    for part in &parts[..parts.len() - 1] {
        if current.get(*part).is_none() {
            current
                .as_table_mut()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "配置结构不是表"))?
                .insert((*part).to_owned(), toml::Value::Table(Default::default()));
        }
        current = current
            .get_mut(*part)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "配置结构无效"))?;
    }
    current
        .as_table_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "配置结构不是表"))?
        .insert(parts[parts.len() - 1].to_owned(), parsed);
    fs::write(
        path(dir),
        toml::to_string_pretty(&value).map_err(io::Error::other)?,
    )
}
