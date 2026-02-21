# remove_schedule

Removes a background job that was previously scheduled using the `scheduler` skill.

## Usage
`<invoke name="remove_schedule">["job_name"]</invoke>`

To remove all schedules at once:
`<invoke name="remove_schedule">["--all"]</invoke>`

## Arguments
- **job_name**: The exact, unique name of the schedule you want to remove (can contain spaces). Or pass `--all` to clear every schedule for this agent.

## Examples

Remove the "daily weather check" schedule:
`<invoke name="remove_schedule">["daily weather check"]</invoke>`

Remove all schedules:
`<invoke name="remove_schedule">["--all"]</invoke>`
