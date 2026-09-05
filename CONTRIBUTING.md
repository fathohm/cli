# Contributing

**This tree is generated.** Fathohm is developed in a private monorepo where the
CLI, the VS Code extension and the hosted web application share the scoring
code. Everything MIT-licensed is exported here by a generator; the rest of that
monorepo is not published.

That has three consequences worth knowing before you spend time:

- **Issues are welcome and are the point of this repository.** Bugs, wrong
  numbers, platform breakage, packaging problems — file them here. Before this
  repository existed the only channel was an email address, which is a bad place
  to report a bug and a worse place to read one.
- **Pull requests are welcome, and are applied upstream and regenerated.** A
  merged patch will not appear here as your commit; it appears in the next
  regeneration, with the change and the credit recorded in the pull request.
  Nothing is lost, but the git history here is the generator's, not the
  contributors'.
- **Do not send structural changes to the import paths.** The shared modules sit
  at `lib/` and `workers/src/` because that is where they sit upstream, and a
  file that differs from the one the hosted service runs breaks the only claim
  this project makes: that you can check the arithmetic yourself.

## Running it

```
npm install
npm test               # the whole suite, including the packaging gate
npm run build          # cli/dist/fathohm.cjs, the published binary
```

The tests need `git` on the path — several build throwaway repositories in a
temporary directory and read them back. Nothing touches the network; there is a
test that asserts as much about the built bundle.

## What this tool may never do

Two bright lines, and a patch that crosses either will be declined however good
it is:

- **It never opens a file in your source tree.** The reading is git metadata —
  authorship, dates, paths, byte counts — plus the `.fathohm.toml` you wrote
  yourself. File contents are never read, stored or transmitted.
- **It opens no network connection.** No telemetry, no version check, no
  upload. The reading runs on a plane.
