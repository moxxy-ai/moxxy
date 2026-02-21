# modify_schedule

Modifies an existing background schedule that was created via the `scheduler` skill.

## Usage
`<invoke name="modify_schedule">["job_name", "new_cron_expression", "new_prompt_text"]</invoke>`

## Arguments
- **job_name**: The exact name of the existing schedule you want to modify.
- **new_cron_expression**: The new standard 6-field cron expression for when it should run. Example: `0 0 9 * * *`
- **new_prompt_text**: The new instruction you want to receive when the job fires.

## Examples

Change the existing "daily_weather" schedule to run at 10 AM instead with a new prompt:
`<invoke name="modify_schedule">["daily_weather", "0 0 10 * * *", "Check the weather in Paris and summarize it."]</invoke>`
