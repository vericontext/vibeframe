# Contributing to VibeEdit

Thank you for your interest in contributing to VibeEdit! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and considerate of others. We want to foster an inclusive and welcoming community.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/vibe-edit.git`
3. Install dependencies: `pnpm install`
4. Create a new branch: `git checkout -b feature/your-feature-name`

## Development Workflow

1. Make your changes in a feature branch
2. Write tests for new functionality
3. Ensure all tests pass: `pnpm test`
4. Ensure code is properly formatted: `pnpm format`
5. Ensure linting passes: `pnpm lint`
6. Commit your changes with a clear message
7. Push to your fork and submit a Pull Request

## Commit Message Guidelines

We follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Example: `feat: add fade in effect to timeline clips`

## Pull Request Guidelines

- Provide a clear description of the changes
- Reference any related issues
- Include screenshots for UI changes
- Ensure CI passes
- Request review from maintainers

## Project Structure

- `apps/web` - Next.js web application
- `packages/core` - Core video editing logic
- `packages/ui` - Shared UI components
- `packages/ai-providers` - AI integration plugins

## Questions?

Feel free to open an issue for any questions or discussions.
