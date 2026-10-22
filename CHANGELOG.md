# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-22

### Added

- Inline comment threads on selected passages in Payload's Lexical editor, with a sidebar panel, replies, resolution and reopening.
- Author attribution, ownership checks and an optional server-side moderation callback.
- Cascading reply deletion with permission pre-checks and rollback on transaction-enabled databases.
- English and French translations, host translation overrides and exported translation types.
- Configurable target collections, comment collection slug and auth collection.
- A `disabled` option that hides commenting UI while retaining stored comments and Lexical marks.
- Payload `^3.90.0` and React 19 support, with integration tests for SQLite, PostgreSQL and MongoDB replica sets.

### Fixed

- Localized quotation marks in the sidebar, drafts and passage previews: English curly quotes and French guillemets with non-breaking spaces, preserving the quoted text.

[0.1.0]: https://github.com/nualt/payload-plugin-comments/tree/v0.1.0
