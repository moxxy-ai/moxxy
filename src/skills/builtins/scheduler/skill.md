# scheduler

This skill allows you to programmatically create recurring background jobs for yourself.
When the chronological condition (cron) is met, you will be automatically invoked in the background with the provided prompt.

## Usage
`<invoke name="scheduler">["job_name", "cron_expression", "prompt_text"]</invoke>`

## Arguments
- **job_name**: A unique identifier for this schedule. If a schedule with this name already exists, it will be overwritten. Use snake_case.
- **cron_expression**: A standard 6-field cron expression (Sec Min Hour Day Month DayOfWeek). Example: `0 0 9 * * *` (Every day at 9:00 AM).
- **prompt_text**: The exact instruction you want to receive when the job fires.

## Examples

Schedule a daily weather report at 8 AM:
`<invoke name="scheduler">["daily_weather", "0 0 8 * * *", "Check the weather in London and summarize it."]</invoke>`

Schedule a task every 5 minutes:
`<invoke name="scheduler">["check_logs", "0 */5 * * * *", "Analyze the latest system logs for anomalies."]</invoke>`

## Notes
- Cron jobs use the system's local time unless otherwise configured.
- The `cron` uses the `sec min hour day month dow` format. Make sure to include the seconds field (usually `0`).
