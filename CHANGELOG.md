# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-18

First public release.

### Added

- Chat interface for Snowflake Cortex Agents with streaming answers, result tables, charts and follow-up suggestions
- Azure AD sign-in with group-based authorization
- Conversation history, saved queries, shared conversations and feedback
- File upload (PDF, CSV, DOCX, images) and Excel export
- Service account API using Azure AD client credentials
- Synthetic sample dataset, semantic model, search service and agents (`examples/`)
- Demo mode (`pnpm demo`): Dev Login and canned answers, with no external accounts
- Terraform for ECS Fargate, ALB, DynamoDB, S3 and Secrets Manager (`deploy/aws/`)
- Documentation under `docs/`

[Unreleased]: https://github.com/kevinzwu/snowflake-chatbot-isabel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kevinzwu/snowflake-chatbot-isabel/releases/tag/v0.1.0
