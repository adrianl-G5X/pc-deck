# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

This policy applies to the Windows installer of PC Deck (`PCDeck-Setup-<version>.exe`) published in the
[GitHub releases](https://github.com/adrianl-G5X/pc-deck/releases) of this repository.

## What is signed

- Only builds produced by the GitHub Actions workflow of this repository ([release.yml](.github/workflows/release.yml)),
  from the source code in this public repository, are submitted for signing.
- Third-party components bundled in the installer (Node.js, LibreHardwareMonitor, PawnIO) keep their own
  licenses and their own signatures where they have one.

## Team roles

| Role | Who |
|---|---|
| Committer and reviewer | [adrianl-G5X](https://github.com/adrianl-G5X) |
| Approver (approves each signing request) | [adrianl-G5X](https://github.com/adrianl-G5X) |

Multi-factor authentication is required on GitHub and on SignPath for every team member.

## Privacy policy

PC Deck runs on the user's own PC and talks only to the user's own devices on their local network (or their
Tailscale network). It does not send any information about the user or their PC to the author or to any
third party. The only automatic connection to the Internet is the optional check for a new version on the
GitHub releases of this repository, and the download of the logo (favicon) of the websites that the user
puts on a button.

## License

PC Deck is released under the [MIT license](LICENSE).
