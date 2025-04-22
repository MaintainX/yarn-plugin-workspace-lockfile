# Cursor Rules for MaintainX

This document describes how Cursor Rules are managed at MaintainX to enhance AI-assisted development.

## What are Cursor Rules?

Cursor Rules are special documentation files that provide contextual information to the Cursor AI assistant, helping it better understand our codebase, conventions, and best practices. These rules help create more accurate AI-assisted development across our repositories.

## Directory Structure

Cursor Rules are stored in:

```
.cursor/rules/        # Local rules directory in each repository
```

## How to Use

Cursor Rules are automatically loaded by the Cursor IDE when you work in a repository. No additional configuration is required.

## How to Contribute New Rules

These rules are a work in progress, and will need to be adapted as we change our conventions and approaches.

Simply add or modify rules in the `cursor-rules` directory (or at the repository root with `.mdc` extension)

## File Format

Cursor Rules are written in Markdown with a `.mdc` extension. See the [Cursor documentation](https://docs.cursor.com/context/rules-for-ai) for more details on rule formatting.

