@AGENTS.md

## Releases

Every push to `main` is a release, and every release bumps the app version
first: `npm version minor --no-git-tag-version`, committed with the change.
Settings shows it as "v1.4" (see `lib/build-id.ts`) and it is the number the
crew reads back when reporting a problem, so a release that skips the bump
leaves two different builds wearing the same label. The up-to-date check
compares commits, so a missed bump can't make a phone look current — but the
label is still wrong, so don't skip it.
