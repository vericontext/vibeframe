# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in VibeFrame, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **security@vibeframe.dev**

You should receive an acknowledgment within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.19.x  | Yes       |
| < 0.19  | No        |

## API Key Safety

VibeFrame uses multiple AI provider API keys. Follow these practices:

### Do
- Store API keys in `.env` files (already in `.gitignore`)
- Use environment variables for CI/CD pipelines
- Rotate keys periodically
- Use provider-specific key scoping where available

### Don't
- Commit `.env` files to version control
- Share API keys in issues, PRs, or discussions
- Hardcode keys in source code
- Use production keys in development

### Required Keys

Each command only requires the key for its specific provider. See [MODELS.md](MODELS.md) for which keys each command needs.

```bash
# Copy the example and fill in only the keys you need
cp .env.example .env
```

## Dependencies

We regularly audit dependencies for known vulnerabilities:

```bash
pnpm audit
```

## FFmpeg Security

VibeFrame shells out to FFmpeg for video processing. All file paths are validated and properly escaped to prevent command injection. If you find a path handling issue, please report it via the process above.
