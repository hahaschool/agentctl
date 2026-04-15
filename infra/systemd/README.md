# AgentCTL peer-update systemd units (Linux)

Opt-in auto-update scheduler for the PM2 mesh topology (roadmap §33.11).
Runs `pnpm peer-update` once per day via a systemd **user** timer.
**Shipped disabled.**

## Why user-scope, not system-scope?

The checkout, PM2 state, and `~/.agentctl/update-history.json` all
live under the operator's home directory. A user-scope unit runs as
the operator, inherits their `$HOME`, and does not require root.

If you need the timer to fire while no user is logged in:

```bash
sudo loginctl enable-linger $USER
```

## Install

```bash
mkdir -p ~/.config/systemd/user

cp infra/systemd/agentctl-peer-update.service \
   ~/.config/systemd/user/agentctl-peer-update.service
cp infra/systemd/agentctl-peer-update.timer \
   ~/.config/systemd/user/agentctl-peer-update.timer

systemctl --user daemon-reload
```

## Enable (operator opt-in)

```bash
systemctl --user enable --now agentctl-peer-update.timer
```

Verify the timer registered:

```bash
systemctl --user list-timers agentctl-peer-update.timer
# NEXT                        LEFT    LAST  PASSED  UNIT
# Wed 2026-04-16 03:00:00 ... 12h ... -     -       agentctl-peer-update.timer
```

## Customise the update window

Default: **03:00 local time, daily** with up to 5 minutes of jitter.

Option A — drop-in (preferred, survives `git pull`):

```bash
systemctl --user edit agentctl-peer-update.timer
# In the editor, add:
# [Timer]
# OnCalendar=
# OnCalendar=*-*-* 04:30:00
```

Option B — set `AGENTCTL_UPDATE_WINDOW=HH:MM` in the service drop-in
for CLI output. The timer's `OnCalendar=` controls when the service
actually runs, so keep them in sync:

```bash
systemctl --user edit agentctl-peer-update.service
# [Service]
# Environment=AGENTCTL_UPDATE_WINDOW=04:30
```

Reload after editing:

```bash
systemctl --user daemon-reload
systemctl --user restart agentctl-peer-update.timer
```

## Inspect last run

```bash
# Timer schedule + last trigger
systemctl --user status agentctl-peer-update.timer

# Service logs (last run's output)
journalctl --user -u agentctl-peer-update.service --since "1 day ago"

# Follow live logs
journalctl --user -u agentctl-peer-update.service -f
```

The CLI also appends a structured entry to
`~/.agentctl/update-history.json` (capped at 100 entries).

## Disable

```bash
systemctl --user disable --now agentctl-peer-update.timer
```

## Uninstall

```bash
systemctl --user disable --now agentctl-peer-update.timer
rm ~/.config/systemd/user/agentctl-peer-update.timer
rm ~/.config/systemd/user/agentctl-peer-update.service
systemctl --user daemon-reload
```

## Adjust the working directory

The unit assumes `%h/agentctl` (i.e. `$HOME/agentctl`). Override via
drop-in if your checkout lives elsewhere:

```bash
systemctl --user edit agentctl-peer-update.service
# [Service]
# WorkingDirectory=
# WorkingDirectory=%h/code/agentctl
```
