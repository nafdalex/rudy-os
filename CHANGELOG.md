# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] · 2026-08-26

**The shipping build.** Version jumps past the pre-rename tags (0.3.3 to 0.4.5 belong to the
old app) so a fresh install can never "update" itself backwards onto a pre-rebrand build.

- **New wordmark and app icon.** The chunky pixel letterforms with the corner notches, RUDY in
  ink, OS in the brand red, and the pixel R tile as the app icon on every platform.
- **One shell, no leftovers.** The whole app speaks one visual language: bold mono caps for
  controls, real switches for on/off, red underline tabs, plain words everywhere. The last of
  the old app's themes, jokes, and copy is gone.
- **Hiring rebuilt.** Four steps under one top rail that never resizes: contract templates named
  after real founder jobs, a skills picker that writes your choice into the hire's standing
  brief, a locked auto-built command with an explicit hand-edit mode, and the gold hire button.
- **Connections that actually connect.** Keyed quick-connects (GitHub, Database, Email and
  Calendar, Web Search) store their credential encrypted, write-only, and inject it at spawn.
  A keyed server with no key is skipped and the row says so.
- **Voice removed.** The dictation and voice-chat features and their settings are gone.
- **Bundled skills work everywhere.** Skill instructions bake each agent's absolute paths at
  spawn, so they run on Windows shells too, and every hire also gets the harness skill set.
- **Auto-compact, visible.** The monitor's context meter says "auto compacts when full" and the
  tooltip explains exactly what happens when a chat fills up.

## [0.3.2] · 2026-08-23

**Rudy OS.** The product is renamed, and the rename goes all the way down: bundle id, deep link
scheme, installer filenames, site, blog, skills and on-disk namespaces. Version resets to 0.3.2
for the first release under the new name.

- **New identity.** RUDY set in the pixel wordmark, OS in the brand accent. White on dark,
  ink on light. The pixel R mark is icon only and never sits beside the wordmark.
- **New palette and new onboarding.** Five fixed-size steps, nothing cut off, nothing that
  reflows between them, and every line written in Rudy's own voice.
- **New cast.** Fifteen clones of Rudy with their own names, portraits and break room banter.
- **New home.** rudydoes.com.
- Deep links, MCP server ids, agy hook groups and the hive bridge all move onto the `rudy`
  namespace. Existing installs keep the previous files on disk until they are removed by hand.

[Unreleased]: https://github.com/nafdalex/rudy-os/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/nafdalex/rudy-os/releases/tag/v0.3.2
