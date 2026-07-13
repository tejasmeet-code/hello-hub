## Rules

### Post-Change Verification Checklist
After every code change, you MUST perform the following 3 mandatory steps:
1. **Check Every Line for Errors**: Run full type checking (`pnpm run typecheck`) and inspect every modified line of bot code to ensure zero syntax, type, or runtime logic errors.
2. **Verify Only Custom Emojis Are Used**: Scan all modified message/embed strings to verify that ONLY custom emojis (e.g. from `CE` in `embedStyle.ts`) are used, and zero default unicode emojis are introduced.
3. **Push to GitHub**: Commit all changes with a descriptive message and push to GitHub immediately after verification (`git push`).

### UI and Embed Formatting
- **Custom Emojis**: When adding or updating code that sends messages, builds embeds, or creates UI elements, ALWAYS use the custom emojis already defined in the codebase (e.g., the `CE` object in `embedStyle.ts`). NEVER use default standard unicode emojis directly.

### Workflow
- **Git Sync**: After successfully implementing, modifying, or testing any change in the codebase, you MUST commit the changes and run `git push` to synchronize them with the remote GitHub repository before concluding your turn.
