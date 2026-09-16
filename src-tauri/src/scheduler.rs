use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::vault::{Result, VaultError};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Recurrence {
    Once,
    Daily,
    Weekly,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanInput {
    pub label: String,
    pub local_start: String,
    pub timezone: String,
    pub recurrence: Recurrence,
    pub notifications: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPlan {
    pub id: String,
    pub label: String,
    pub local_start: String,
    pub timezone: String,
    pub recurrence: Recurrence,
    pub notifications: bool,
    pub enabled: bool,
    pub next_at: String,
    pub revision: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuePlan {
    pub id: String,
    pub notifications: bool,
    pub scheduled_at: String,
}

pub fn initialize(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_plans (
            id TEXT PRIMARY KEY, data TEXT NOT NULL, next_at TEXT NOT NULL,
            enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), revision INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS session_plans_due ON session_plans(enabled, next_at);",
    )?;
    Ok(())
}

fn input_error() -> VaultError {
    VaultError::InvalidInput("Choose a valid date, time, and IANA timezone.")
}

fn wall_time(timezone: Tz, local: NaiveDateTime) -> Result<DateTime<Utc>> {
    // Choose the first repeated time. Move a nonexistent wall time to the
    // next valid minute, including regions that have skipped an entire day.
    for minutes in 0..=26 * 60 {
        let candidate = local
            .checked_add_signed(Duration::minutes(minutes))
            .ok_or_else(input_error)?;
        match timezone.from_local_datetime(&candidate) {
            LocalResult::Single(time) => return Ok(time.with_timezone(&Utc)),
            LocalResult::Ambiguous(first, second) => {
                return Ok(first.min(second).with_timezone(&Utc));
            }
            LocalResult::None => {}
        }
    }
    Err(input_error())
}

pub fn next_after(input: &PlanInput, after: DateTime<Utc>) -> Result<DateTime<Utc>> {
    let timezone: Tz = input.timezone.parse().map_err(|_| input_error())?;
    let start = NaiveDateTime::parse_from_str(&input.local_start, "%Y-%m-%dT%H:%M")
        .map_err(|_| input_error())?;
    if input.recurrence == Recurrence::Once {
        let next = wall_time(timezone, start)?;
        return if next > after {
            Ok(next)
        } else {
            Err(VaultError::InvalidInput(
                "Choose a future time for a one-time session.",
            ))
        };
    }
    let today = after.with_timezone(&timezone).date_naive();
    let date = today.max(start.date());
    for offset in 0..=14 {
        let day = date
            .checked_add_signed(Duration::days(offset))
            .ok_or_else(input_error)?;
        if input.recurrence == Recurrence::Weekly
            && day.signed_duration_since(start.date()).num_days() % 7 != 0
        {
            continue;
        }
        let candidate = wall_time(timezone, day.and_time(start.time()))?;
        if candidate > after {
            return Ok(candidate);
        }
    }
    Err(input_error())
}

pub fn list(connection: &Connection) -> Result<Vec<SessionPlan>> {
    initialize(connection)?;
    let mut statement =
        connection.prepare("SELECT data FROM session_plans ORDER BY next_at, id")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    rows.map(|row| serde_json::from_str(&row?).map_err(|_| VaultError::CorruptDatabase))
        .collect()
}

pub fn create(
    connection: &Connection,
    input: PlanInput,
    now: DateTime<Utc>,
) -> Result<SessionPlan> {
    initialize(connection)?;
    if input.label.trim().is_empty() || input.label.chars().count() > 80 {
        return Err(VaultError::InvalidInput(
            "Use a session label of 1 to 80 characters.",
        ));
    }
    let count: i64 =
        connection.query_row("SELECT count(*) FROM session_plans", [], |row| row.get(0))?;
    if count >= 100 {
        return Err(VaultError::InvalidInput(
            "Remove an old plan before adding another.",
        ));
    }
    let next = next_after(&input, now)?;
    let plan = SessionPlan {
        id: Uuid::new_v4().to_string(),
        label: input.label.trim().to_owned(),
        local_start: input.local_start,
        timezone: input.timezone,
        recurrence: input.recurrence,
        notifications: input.notifications,
        enabled: true,
        next_at: next.to_rfc3339(),
        revision: 1,
    };
    let data = serde_json::to_string(&plan).map_err(|_| VaultError::CorruptDatabase)?;
    connection.execute(
        "INSERT INTO session_plans(id,data,next_at,enabled,revision) VALUES(?1,?2,?3,1,1)",
        params![plan.id, data, plan.next_at],
    )?;
    Ok(plan)
}

pub fn remove(connection: &Connection, id: &str, revision: i64) -> Result<()> {
    initialize(connection)?;
    if connection.execute(
        "DELETE FROM session_plans WHERE id=?1 AND revision=?2",
        params![id, revision],
    )? == 0
    {
        return Err(VaultError::InvalidInput(
            "This plan changed. Reload it before removing it.",
        ));
    }
    Ok(())
}

pub fn set_enabled(
    connection: &Connection,
    id: &str,
    enabled: bool,
    revision: i64,
    now: DateTime<Utc>,
) -> Result<SessionPlan> {
    initialize(connection)?;
    let data: String = connection
        .query_row(
            "SELECT data FROM session_plans WHERE id=?1 AND revision=?2",
            params![id, revision],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(VaultError::InvalidInput(
            "This plan changed. Reload it before updating it.",
        ))?;
    let mut plan: SessionPlan =
        serde_json::from_str(&data).map_err(|_| VaultError::CorruptDatabase)?;
    if enabled {
        plan.next_at = next_after(&as_input(&plan), now)?.to_rfc3339();
    }
    plan.enabled = enabled;
    plan.revision += 1;
    persist(connection, &plan, revision)?;
    Ok(plan)
}

fn as_input(plan: &SessionPlan) -> PlanInput {
    PlanInput {
        label: plan.label.clone(),
        local_start: plan.local_start.clone(),
        timezone: plan.timezone.clone(),
        recurrence: plan.recurrence,
        notifications: plan.notifications,
    }
}

fn persist(connection: &Connection, plan: &SessionPlan, revision: i64) -> Result<()> {
    let data = serde_json::to_string(plan).map_err(|_| VaultError::CorruptDatabase)?;
    if connection.execute("UPDATE session_plans SET data=?1,next_at=?2,enabled=?3,revision=?4 WHERE id=?5 AND revision=?6", params![data,plan.next_at,plan.enabled,plan.revision,plan.id,revision])? != 1 {
        return Err(VaultError::InvalidInput("This plan changed. Reload it before updating it."));
    }
    Ok(())
}

pub fn poll(connection: &mut Connection, now: DateTime<Utc>) -> Result<Vec<DuePlan>> {
    initialize(connection)?;
    let transaction = connection.transaction()?;
    let plans = list(&transaction)?;
    let mut due = Vec::new();
    for mut plan in plans.into_iter().filter(|plan| plan.enabled) {
        let at =
            DateTime::parse_from_rfc3339(&plan.next_at).map_err(|_| VaultError::CorruptDatabase)?;
        if at > now {
            continue;
        }
        due.push(DuePlan {
            id: plan.id.clone(),
            notifications: plan.notifications,
            scheduled_at: plan.next_at.clone(),
        });
        let revision = plan.revision;
        if plan.recurrence == Recurrence::Once {
            plan.enabled = false;
        } else {
            plan.next_at = next_after(&as_input(&plan), now)?.to_rfc3339();
        }
        plan.revision += 1;
        persist(&transaction, &plan, revision)?;
    }
    transaction.commit()?;
    Ok(due)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(start: &str, timezone: &str, recurrence: Recurrence) -> PlanInput {
        PlanInput {
            label: "A little time to reflect".into(),
            local_start: start.into(),
            timezone: timezone.into(),
            recurrence,
            notifications: false,
        }
    }
    fn utc(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn moves_gap_to_first_valid_minute() {
        let next = next_after(
            &input("2026-03-08T02:30", "America/New_York", Recurrence::Once),
            utc("2026-03-07T00:00:00Z"),
        )
        .unwrap();
        assert_eq!(next, utc("2026-03-08T07:00:00Z"));
    }
    #[test]
    fn repeated_hour_notifies_once() {
        let plan = input("2026-11-01T01:30", "America/New_York", Recurrence::Daily);
        assert_eq!(
            next_after(&plan, utc("2026-11-01T04:00:00Z")).unwrap(),
            utc("2026-11-01T05:30:00Z")
        );
        assert_eq!(
            next_after(&plan, utc("2026-11-01T05:31:00Z")).unwrap(),
            utc("2026-11-02T06:30:00Z")
        );
    }
    #[test]
    fn missed_weeks_coalesce_and_claim_is_durable() {
        let mut connection = Connection::open_in_memory().unwrap();
        create(
            &connection,
            input("2026-01-05T09:00", "Asia/Kolkata", Recurrence::Weekly),
            utc("2026-01-01T00:00:00Z"),
        )
        .unwrap();
        assert_eq!(
            poll(&mut connection, utc("2026-03-01T00:00:00Z"))
                .unwrap()
                .len(),
            1
        );
        assert!(poll(&mut connection, utc("2026-03-01T00:00:00Z"))
            .unwrap()
            .is_empty());
        assert_eq!(
            list(&connection).unwrap()[0].next_at,
            "2026-03-02T03:30:00+00:00"
        );
    }
    #[test]
    fn stale_changes_and_invalid_timezones_are_rejected() {
        let connection = Connection::open_in_memory().unwrap();
        let now = utc("2026-01-01T00:00:00Z");
        assert!(create(
            &connection,
            input("2026-01-02T09:00", "Unknown/Place", Recurrence::Daily),
            now
        )
        .is_err());
        let plan = create(
            &connection,
            input("2026-01-02T09:00", "UTC", Recurrence::Daily),
            now,
        )
        .unwrap();
        set_enabled(&connection, &plan.id, false, 1, now).unwrap();
        assert!(remove(&connection, &plan.id, 1).is_err());
        remove(&connection, &plan.id, 2).unwrap();
    }
}
