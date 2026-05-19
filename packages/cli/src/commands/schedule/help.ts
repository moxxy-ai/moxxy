import { formatHelp } from '../help-format.js';

export const SCHEDULE_HELP = formatHelp({
  title: 'moxxy schedule',
  tagline: 'manage time-driven prompts',
  sections: [
    {
      title: 'COMMANDS',
      rows: [
        ['list', 'show every schedule with next fire time'],
        ['add <name> --cron "<expr>" --prompt "…"', 'create a recurring schedule'],
        ['add <name> --at "<iso>" --prompt "…"', 'create a one-shot at a specific timestamp'],
        ['remove <id>', 'delete a schedule'],
        ['enable <id>', 're-enable a disabled schedule'],
        ['disable <id>', 'pause without deleting'],
        ['run <id>', 'fire one immediately (for testing)'],
      ],
    },
    {
      title: 'DAEMON',
      rows: [
        ['daemon', 'run the poller headless until ^C'],
        ['daemon --background', 'install + start an OS unit (launchd / systemd --user)'],
        ['daemon --status', 'report whether the OS unit is loaded'],
        ['daemon --stop', 'unload + delete the OS unit'],
        ['setup', 'install the daemon AND pre-allow common headless tools'],
      ],
    },
    {
      title: 'ADD FLAGS',
      rows: [
        ['--channel <name>', "soft hint, e.g. 'telegram' (prompt calls the matching send tool)"],
        ['--model <id>', 'override the active model just for this schedule'],
        ['--timezone <zone>', 'IANA zone for cron interpretation (default: system local)'],
      ],
    },
  ],
  footer: [
    "Schedules are stored in ~/.moxxy/schedules.json. For 24/7 firing run",
    "'moxxy schedule daemon --background' once; for ad-hoc testing the",
    "foreground 'moxxy schedule daemon' (Ctrl+C to stop) is fine.",
  ],
});
