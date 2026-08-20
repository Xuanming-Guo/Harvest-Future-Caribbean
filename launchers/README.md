# Windows launchers

These shortcuts open Harvest without requiring you to type npm commands into a
terminal. Double-click the file for the participant you want to demonstrate:

- `Open Farmer.bat`
- `Open Buyer.bat`
- `Open Transporter.bat`
- `Open Coordinator.bat`
- `Open Simulation Control Room.bat`

The first participant launcher starts PostgreSQL, the Product API on port
`3001`, and the website on port `3000` in a visible terminal. It waits for both
services, signs in as the selected seeded persona, and opens that role's normal
workspace. Later participant launchers reuse the running services instead of
starting them again or reseeding the development database.

The control-room launcher also starts the separate interface on port `3002`.
It leaves the Product API and participant website running because the control
room needs both services.

## Requirements

- Windows 10 or 11
- Node.js 20.18 or newer
- Docker Desktop with Docker Compose, already running
- Internet access the first time npm dependencies need to be installed

The launcher installs npm dependencies if `node_modules` is missing. It does
not install Node.js or Docker Desktop. If a required port is occupied by the
wrong process, the launcher reports the port instead of starting a duplicate
Harvest server.

The launcher asks Windows to open localhost using the registered default app
for HTTP links. If no browser opens, select a default browser under **Windows
Settings > Apps > Default apps**, associate it with HTTP and HTTPS, and try
again. Any browser-opening error keeps the launcher window open and prints the
complete localhost address so it can be opened manually.

## Stopping Harvest

Press `Ctrl+C` in each visible Harvest terminal and then close the terminal.
The participant stack and control room run in separate terminals. PostgreSQL
continues in Docker until Docker Desktop stops or you run `npm run db:down`.

## Role sessions and tutorials

The four participant shortcuts use the existing development-only login flow.
Only the four seeded participant personas are accepted, and the launcher URL is
removed as soon as the website consumes it. This mechanism is unavailable in a
production build.

The first time a persona opens the website, the existing tutorial question is
still shown. Each persona's answer remains stored separately.

Use one role at a time. Browser tabs in the same browser profile share the
Harvest development session, so opening another launcher replaces the active
role. Close older Harvest tabs before working in the newly opened role.
