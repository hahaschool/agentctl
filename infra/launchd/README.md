# AgentCTL peer-update LaunchAgent (macOS)

Opt-in auto-update scheduler for the PM2 mesh topology (roadmap §33.11).
Invokes `pnpm peer-update` on a daily schedule. **Shipped disabled.**

## Install

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/agentctl

# Copy the template, then edit WorkingDirectory and StandardOut/ErrPath
# to point at your actual checkout and log directory.
cp infra/launchd/com.agentctl.peer-update.plist \
   ~/Library/LaunchAgents/com.agentctl.peer-update.plist

# Replace CHANGE_ME with your username in-place.
sed -i '' "s|/Users/CHANGE_ME|$HOME|g" \
   ~/Library/LaunchAgents/com.agentctl.peer-update.plist

# Validate the plist parses cleanly.
plutil -lint ~/Library/LaunchAgents/com.agentctl.peer-update.plist
```

## Enable (operator opt-in)

```bash
launchctl load -w ~/Library/LaunchAgents/com.agentctl.peer-update.plist
```

The `-w` flag flips the `Disabled=true` marker to `false` in the
per-user override database. Without `-w`, `load` will refuse to
register the disabled job.

## Customise the update window

Default cadence is **03:00 local time, daily**. Two knobs:

1. Edit `StartCalendarInterval.Hour` / `.Minute` directly in the plist.
2. Set `AGENTCTL_UPDATE_WINDOW=HH:MM` in `EnvironmentVariables`. The
   CLI reads this variable for informational log output; launchd
   itself only honours the calendar keys, so keep the two in sync.

After editing, reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.agentctl.peer-update.plist
launchctl load -w ~/Library/LaunchAgents/com.agentctl.peer-update.plist
```

## Inspect last run

```bash
launchctl print gui/$(id -u)/com.agentctl.peer-update
tail -f ~/Library/Logs/agentctl/peer-update.out.log
tail -f ~/Library/Logs/agentctl/peer-update.err.log
```

The CLI also appends a structured entry to
`~/.agentctl/update-history.json` after every run (capped at 100
entries). Read that file for machine-consumable history.

## Disable

```bash
launchctl unload -w ~/Library/LaunchAgents/com.agentctl.peer-update.plist
```

The `-w` flag persists `Disabled=true`, so a reboot does not
re-register the job.

## Uninstall

```bash
launchctl unload -w ~/Library/LaunchAgents/com.agentctl.peer-update.plist
rm ~/Library/LaunchAgents/com.agentctl.peer-update.plist
```
