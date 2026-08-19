use crate::model::{Reminder, Task};
use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc,
};
use regex::Regex;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Parsed {
    pub title: String,
    pub due: Option<DateTime<Utc>>,
    pub priority: Option<String>,
    pub tags: Vec<String>,
    pub project: Option<String>,
    pub parent: Option<String>,
    pub wait: Option<NaiveDate>,
    pub reminders: Vec<Reminder>,
}

pub fn parse(text: &str, now: DateTime<Utc>, levels: &[String]) -> Parsed {
    let today = now.date_naive();
    let mut source = text.trim().to_owned();
    let mut parsed = Parsed::default();
    extract_all(&mut source, r"#([^\s#，,：:]+)", |v| parsed.tags.push(v));
    parsed.project = extract_one(&mut source, r"(?:proj|project|项目)[:：]([^\s，,]+)");
    parsed.parent = extract_one(&mut source, r"\^([A-Za-z0-9_-]{3,})");
    if let Some(raw) = extract_one(&mut source, r"~([^\s~]+)") {
        parsed.wait = parse_date(&raw, today);
    }
    let reminder_re = Regex::new(
        r"(?i)@(?P<value>(?:\d{1,2}:\d{2})|(?:\d+(?:m|h|d|分钟|小时|天)?)|(?:day\s+after\s+tomorrow|this\s+weekend|next\s+(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?|today|tonight|tomorrow|今晚|明晚|今天|明天|后天|大后天|周末|(?:上|本|这|下)?月(?:初|末|底)|月初|月末|月底|(?:本|这|下)?(?:周|星期|礼拜)[一二三四五六日天]|元旦|春节|清明节?|劳动节|五一|端午节?|中秋节?|国庆节?|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}月\d{1,2}日))(?::(?P<hooks>[A-Za-z][A-Za-z0-9_,-]*))?",
    )
    .unwrap();
    let reminder_specs: Vec<(String, Option<String>)> = reminder_re
        .captures_iter(&source)
        .map(|capture| {
            (
                capture["value"].to_owned(),
                capture.name("hooks").map(|value| value.as_str().to_owned()),
            )
        })
        .collect();
    source = reminder_re.replace_all(&source, " ").into_owned();
    let date_re = Regex::new(
        r"(?ix)(\bday\s+after\s+tomorrow\b|\bthis\s+weekend\b|\bnext\s+(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\btoday\b|\btonight\b|\btomorrow\b|今晚|明晚|今天|明天|后天|大后天|周末|(?:上|本|这|下)?月(?:初|末|底)|月初|月末|月底|元旦|春节|清明节?|劳动节|五一|端午节?|中秋节?|国庆节?|(?:本|这|下)?(?:周|星期|礼拜)[一二三四五六日天]|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}月\d{1,2}日)",
    )
    .unwrap();
    let date_match = date_re.find(&source).map(|m| m.as_str().to_owned());
    let date = date_match
        .as_deref()
        .and_then(|value| parse_date(value, today));
    source = date_re.replace(&source, " ").into_owned();
    let time_re=Regex::new(r"(?:(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)\s*)?(\d{1,2})(?:(?::|：|点)(\d{1,2}|半)?(?:分)?)").unwrap();
    let implicit_time = date_match.as_deref().and_then(|value| {
        if matches!(value.to_ascii_lowercase().as_str(), "tonight")
            || matches!(value, "今晚" | "明晚")
        {
            NaiveTime::from_hms_opt(20, 0, 0)
        } else {
            None
        }
    });
    let time = time_re.captures(&source).and_then(|c| {
        parse_time(
            c.get(1).map(|m| m.as_str()),
            &c[2],
            c.get(3).map(|m| m.as_str()),
        )
    });
    source = time_re.replace(&source, " ").into_owned();
    if let Some(day) = date.or_else(|| time.map(|_| today)) {
        parsed.due = utc(day.and_time(time.or(implicit_time).unwrap_or(NaiveTime::MIN)));
    }
    for (value, hooks) in reminder_specs {
        if let Some(at) = parse_reminder_at(&value, now, parsed.due) {
            parsed.reminders.push(Reminder {
                at: at.to_rfc3339(),
                hooks: hooks
                    .map(|value| value.split(',').map(str::to_lowercase).collect())
                    .unwrap_or_else(|| vec!["toast".into()]),
                ..Default::default()
            });
        }
    }
    for (word, fallback) in [
        ("特急", "高"),
        ("很急", "高"),
        ("紧急", "高"),
        ("重要", "高"),
        ("一般", "中"),
        ("不急", "低"),
    ] {
        if source.contains(word) {
            parsed.priority = levels
                .iter()
                .find(|x| x.as_str() == fallback)
                .cloned()
                .or_else(|| Some(fallback.into()));
            source = source.replace(word, " ");
            break;
        }
    }
    parsed.tags.sort();
    parsed.tags.dedup();
    parsed.title = source.split_whitespace().collect::<Vec<_>>().join(" ");
    parsed
}
fn utc(value: NaiveDateTime) -> Option<DateTime<Utc>> {
    match Utc.from_local_datetime(&value) {
        LocalResult::Single(v) => Some(v),
        _ => None,
    }
}
fn extract_one(source: &mut String, pattern: &str) -> Option<String> {
    let re = Regex::new(pattern).unwrap();
    let value = re
        .captures(source)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_owned());
    *source = re.replace(source.as_str(), " ").into_owned();
    value
}
fn extract_all<F: FnMut(String)>(source: &mut String, pattern: &str, mut push: F) {
    let re = Regex::new(pattern).unwrap();
    let values: Vec<_> = re
        .captures_iter(source)
        .filter_map(|c| c.get(1))
        .map(|m| m.as_str().to_owned())
        .collect();
    for v in values {
        push(v)
    }
    *source = re.replace_all(source.as_str(), " ").into_owned();
}
fn parse_reminder_at(
    raw: &str,
    now: DateTime<Utc>,
    due: Option<DateTime<Utc>>,
) -> Option<DateTime<Utc>> {
    if let Some((amount, unit)) = parse_relative_duration(raw) {
        let delta = match unit {
            "h" | "小时" => Duration::hours(amount),
            "d" | "天" => Duration::days(amount),
            _ => Duration::minutes(amount),
        };
        return Some(now + delta);
    }
    if let Some((hour, minute)) = raw.split_once(':') {
        let time = parse_time(None, hour, Some(minute))?;
        let day = due
            .map(|value| value.date_naive())
            .unwrap_or(now.date_naive());
        let mut at = utc(day.and_time(time))?;
        if due.is_none() && at <= now {
            at += Duration::days(1);
        }
        return Some(at);
    }
    let day = parse_date(raw, now.date_naive())?;
    utc(day.and_time(NaiveTime::MIN))
}
fn parse_relative_duration(raw: &str) -> Option<(i64, &str)> {
    let split = raw
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(raw.len());
    let (amount, unit) = raw.split_at(split);
    if amount.is_empty() || !matches!(unit, "" | "m" | "h" | "d" | "分钟" | "小时" | "天") {
        return None;
    }
    Some((amount.parse().ok()?, unit))
}
pub fn scan_date(raw: &str, today: NaiveDate) -> Option<NaiveDate> {
    parse_date(raw, today)
}

fn parse_date(raw: &str, today: NaiveDate) -> Option<NaiveDate> {
    let english = raw.trim().to_ascii_lowercase();
    match english.as_str() {
        "today" | "tonight" => return Some(today),
        "tomorrow" => return Some(today + Duration::days(1)),
        "day after tomorrow" => return Some(today + Duration::days(2)),
        "this weekend" => {
            let delta = 5 - today.weekday().num_days_from_monday() as i64;
            return Some(today + Duration::days(if delta < 0 { 7 } else { delta }));
        }
        value if value.starts_with("next ") => {
            return next_english_weekday(value.trim_start_matches("next "), today);
        }
        _ => {}
    }
    match raw {
        "今天" => Some(today),
        "今晚" => Some(today),
        "明晚" => Some(today + Duration::days(1)),
        "明天" => Some(today + Duration::days(1)),
        "后天" => Some(today + Duration::days(2)),
        "大后天" => Some(today + Duration::days(3)),
        "周末" => {
            let delta = 5 - today.weekday().num_days_from_monday() as i64;
            Some(today + Duration::days(if delta < 0 { 7 } else { delta }))
        }
        "上月初" => month_edge(today, -1, false),
        "上月末" | "上月底" => month_edge(today, -1, true),
        "本月初" | "这月初" | "月初" => month_edge(today, 0, false),
        "本月末" | "本月底" | "这月末" | "这月底" | "月末" | "月底" => {
            month_edge(today, 0, true)
        }
        "下月初" => month_edge(today, 1, false),
        "下月末" | "下月底" => month_edge(today, 1, true),
        "元旦" => next_annual_date(today, 1, 1),
        "劳动节" | "五一" => next_annual_date(today, 5, 1),
        "国庆" | "国庆节" => next_annual_date(today, 10, 1),
        "春节" | "清明" | "清明节" | "端午" | "端午节" | "中秋" | "中秋节" => {
            let name = if raw == "春节" {
                raw
            } else {
                raw.trim_end_matches('节')
            };
            next_chinese_holiday(name, today)
        }
        _ => {
            let normalized = raw.replace(['年', '月', '/', '.'], "-").replace('日', "");
            if let Ok(d) = NaiveDate::parse_from_str(normalized.trim_end_matches('-'), "%Y-%m-%d") {
                return Some(d);
            }
            if let Some((m, d)) = normalized.trim_end_matches('-').split_once('-') {
                if let (Ok(m), Ok(d)) = (m.parse(), d.parse()) {
                    return NaiveDate::from_ymd_opt(today.year(), m, d);
                }
            }
            let re = Regex::new(r"(?:(本|这|下)?(?:周|星期|礼拜))([一二三四五六日天])").unwrap();
            let c = re.captures(raw)?;
            let target = "一二三四五六日".find(&c[2])? as i64;
            let current = today.weekday().num_days_from_monday() as i64;
            let mut delta = (target - current + 7) % 7;
            if c.get(1).is_some_and(|m| m.as_str() == "下") {
                delta += 7
            } else if delta == 0 {
                delta = 7
            }
            Some(today + Duration::days(delta))
        }
    }
}
fn next_english_weekday(raw: &str, today: NaiveDate) -> Option<NaiveDate> {
    let target = match raw.trim_end_matches("day") {
        "mon" => 0,
        "tue" | "tues" => 1,
        "wed" | "wednes" => 2,
        "thu" | "thur" | "thurs" => 3,
        "fri" => 4,
        "sat" | "satur" => 5,
        "sun" => 6,
        _ => return None,
    };
    let current = today.weekday().num_days_from_monday() as i64;
    let delta = (target - current + 7) % 7 + 7;
    Some(today + Duration::days(delta))
}

fn month_edge(today: NaiveDate, offset: i32, end: bool) -> Option<NaiveDate> {
    let month_index = today.year() * 12 + today.month0() as i32 + offset;
    let year = month_index.div_euclid(12);
    let month = month_index.rem_euclid(12) as u32 + 1;
    let start = NaiveDate::from_ymd_opt(year, month, 1)?;
    if !end {
        return Some(start);
    }
    let next_index = month_index + 1;
    let next = NaiveDate::from_ymd_opt(
        next_index.div_euclid(12),
        next_index.rem_euclid(12) as u32 + 1,
        1,
    )?;
    Some(next - Duration::days(1))
}
fn next_annual_date(today: NaiveDate, month: u32, day: u32) -> Option<NaiveDate> {
    let current = NaiveDate::from_ymd_opt(today.year(), month, day)?;
    if current < today {
        NaiveDate::from_ymd_opt(today.year() + 1, month, day)
    } else {
        Some(current)
    }
}
fn next_chinese_holiday(name: &str, today: NaiveDate) -> Option<NaiveDate> {
    // Gregorian dates for the movable holidays; fixed-date holidays are handled above.
    const DATES: &[(i32, &str, u32, u32)] = &[
        (2024, "春节", 2, 10),
        (2024, "清明", 4, 4),
        (2024, "端午", 6, 10),
        (2024, "中秋", 9, 17),
        (2025, "春节", 1, 29),
        (2025, "清明", 4, 4),
        (2025, "端午", 5, 31),
        (2025, "中秋", 10, 6),
        (2026, "春节", 2, 17),
        (2026, "清明", 4, 5),
        (2026, "端午", 6, 19),
        (2026, "中秋", 9, 25),
        (2027, "春节", 2, 6),
        (2027, "清明", 4, 5),
        (2027, "端午", 6, 9),
        (2027, "中秋", 9, 15),
        (2028, "春节", 1, 26),
        (2028, "清明", 4, 4),
        (2028, "端午", 5, 28),
        (2028, "中秋", 10, 3),
        (2029, "春节", 2, 13),
        (2029, "清明", 4, 4),
        (2029, "端午", 6, 16),
        (2029, "中秋", 9, 22),
        (2030, "春节", 2, 3),
        (2030, "清明", 4, 5),
        (2030, "端午", 6, 5),
        (2030, "中秋", 9, 12),
    ];
    DATES
        .iter()
        .filter(|(year, holiday, _, _)| *holiday == name && *year >= today.year())
        .filter_map(|(year, _, month, day)| NaiveDate::from_ymd_opt(*year, *month, *day))
        .find(|date| *date >= today)
}
fn parse_time(period: Option<&str>, hour: &str, minute: Option<&str>) -> Option<NaiveTime> {
    let mut h: u32 = hour.parse().ok()?;
    let m = match minute {
        Some("半") => 30,
        Some(v) => v.parse().ok()?,
        None => 0,
    };
    if matches!(period, Some("下午" | "傍晚" | "晚上" | "夜里")) && h < 12 {
        h += 12
    }
    if period == Some("中午") && h < 11 {
        h += 12
    }
    if period == Some("凌晨") && h == 12 {
        h = 0
    }
    NaiveTime::from_hms_opt(h, m, 0)
}
pub fn apply(task: &mut Task, parsed: &Parsed) {
    if !parsed.title.is_empty() {
        task.title = parsed.title.clone()
    }
    if parsed.due.is_some() {
        task.due = parsed.due
    }
    if parsed.priority.is_some() {
        task.priority = parsed.priority.clone()
    }
    if !parsed.tags.is_empty() {
        task.tags = parsed.tags.clone()
    }
    if parsed.project.is_some() {
        task.project = parsed.project.clone()
    }
    if parsed.parent.is_some() {
        task.parent = parsed.parent.clone()
    }
    if parsed.wait.is_some() {
        task.wait = parsed.wait
    }
    if !parsed.reminders.is_empty() {
        task.reminders = parsed.reminders.clone()
    }
    task.normalize();
}
pub fn preview(parsed: &Parsed) -> String {
    format!(
        "标题：{}\n截止：{}\n优先级：{}\n标签：{}\n项目：{}\n提醒：{}",
        parsed.title,
        parsed
            .due
            .map(|d| d.to_rfc3339())
            .unwrap_or_else(|| "无".into()),
        parsed.priority.as_deref().unwrap_or("无"),
        if parsed.tags.is_empty() {
            "无".into()
        } else {
            parsed.tags.join(", ")
        },
        parsed.project.as_deref().unwrap_or("无"),
        parsed.reminders.len()
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;
    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 19, 8, 0, 0).unwrap()
    }
    #[test]
    fn parses_chinese_date_time() {
        let p = parse(
            "明天下午3点 开会 #工作 紧急",
            now(),
            &crate::priority::levels(),
        );
        assert_eq!(p.title, "开会");
        assert_eq!(p.tags, vec!["工作"]);
        assert_eq!(p.due.unwrap().hour(), 15);
    }
    #[test]
    fn parses_english_relative_dates_and_removes_them_from_title() {
        let tomorrow = parse(
            "meet the monitor seller tomorrow",
            now(),
            &crate::priority::levels(),
        );
        assert_eq!(tomorrow.title, "meet the monitor seller");
        assert_eq!(
            tomorrow.due.unwrap().date_naive(),
            NaiveDate::from_ymd_opt(2026, 8, 20).unwrap()
        );

        let next_friday = parse("Meet seller NEXT FRIDAY", now(), &crate::priority::levels());
        assert_eq!(next_friday.title, "Meet seller");
        assert_eq!(
            next_friday.due.unwrap().date_naive(),
            NaiveDate::from_ymd_opt(2026, 8, 28).unwrap()
        );
    }

    #[test]
    fn parses_english_date_reminders() {
        let parsed = parse(
            "meet the seller @tomorrow",
            now(),
            &crate::priority::levels(),
        );
        assert_eq!(parsed.title, "meet the seller");
        assert_eq!(
            crate::parse_datetime(&parsed.reminders[0].at)
                .unwrap()
                .date_naive(),
            NaiveDate::from_ymd_opt(2026, 8, 20).unwrap()
        );
    }

    #[test]
    fn parses_relative_reminder() {
        let p = parse("喝水 @2h:toast", now(), &crate::priority::levels());
        assert_eq!(p.reminders.len(), 1);
    }
    #[test]
    fn absolute_time_reminder_anchors_to_due_date() {
        let p = parse(
            "明天交稿 @18:30:toast,email",
            now(),
            &crate::priority::levels(),
        );
        let reminder = crate::parse_datetime(&p.reminders[0].at).unwrap();
        assert_eq!(
            reminder.date_naive(),
            now().date_naive() + Duration::days(1)
        );
        assert_eq!((reminder.hour(), reminder.minute()), (18, 30));
        assert_eq!(p.reminders[0].hooks, vec!["toast", "email"]);
    }
    #[test]
    fn past_time_only_reminder_advances_to_tomorrow() {
        let p = parse("复盘 @07:30", now(), &crate::priority::levels());
        let reminder = crate::parse_datetime(&p.reminders[0].at).unwrap();
        assert_eq!(
            reminder.date_naive(),
            now().date_naive() + Duration::days(1)
        );
    }
    #[test]
    fn date_reminders_and_month_edges_are_supported() {
        let reminder = parse("休息 @明天", now(), &crate::priority::levels());
        assert_eq!(
            crate::parse_datetime(&reminder.reminders[0].at)
                .unwrap()
                .date_naive(),
            NaiveDate::from_ymd_opt(2026, 8, 20).unwrap()
        );
        assert_eq!(
            parse("月底结账", now(), &crate::priority::levels())
                .due
                .unwrap()
                .date_naive(),
            NaiveDate::from_ymd_opt(2026, 8, 31).unwrap()
        );
        assert_eq!(
            parse("下月初计划", now(), &crate::priority::levels())
                .due
                .unwrap()
                .date_naive(),
            NaiveDate::from_ymd_opt(2026, 9, 1).unwrap()
        );
    }
    #[test]
    fn numeric_past_date_stays_literal() {
        let parsed = parse("8月17日 复盘", now(), &crate::priority::levels());
        assert_eq!(
            parsed.due.unwrap().date_naive(),
            NaiveDate::from_ymd_opt(2026, 8, 17).unwrap()
        );
    }

    #[test]
    fn common_chinese_holidays_are_supported() {
        assert_eq!(
            parse("国庆节出游", now(), &crate::priority::levels())
                .due
                .unwrap()
                .date_naive(),
            NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()
        );
        assert_eq!(
            parse("中秋团圆", now(), &crate::priority::levels())
                .due
                .unwrap()
                .date_naive(),
            NaiveDate::from_ymd_opt(2026, 9, 25).unwrap()
        );
        assert_eq!(
            parse("春节回家", now(), &crate::priority::levels())
                .due
                .unwrap()
                .date_naive(),
            NaiveDate::from_ymd_opt(2027, 2, 6).unwrap()
        );
    }
}
