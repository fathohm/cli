# Changelog — fathohm CLI

Every release, newest first. The README carries what the tool does now; this
carries what moved and why.

## 1.6.3

Five bugs, and one the new Windows CI job found on its way in.

**`.env` is configuration, not code**, and it no longer enters a reading. It
was scored for a structural reason rather than a considered one: `.env` has no
extension to deny by, because the leading dot is the whole name. Denied as a
class — `.env`, `.env.local`, `.env.production.local`, `production.env`.
`.envrc` stays in: direnv's file is a shell script, and a shell script is code.

**`team --json` no longer carries email addresses.** The identity the scorer
counts is a lowercased git email, and this is the one document built to be
piped into CI, posted onto a pull request and kept as an artefact — the card
beside it prints names, so the machine form was disclosing more than the human
form of the same reading. It carries `fh_<12 hex>` instead, and `--without`
takes that spelling, so a pipeline that read a key out of the document and
handed it back keeps working. It is not anonymisation and does not claim to be:
an email is low-entropy, and anyone holding the repository can rebuild the
mapping from its own history. The claim is only that the document does not
carry the address.

**`map --json` names the file relative to the working directory.** Every other
path in that document is repo-relative; this one named the machine that wrote
it. It stays absolute on exactly one shape — a target on a different Windows
drive, where no relative path exists at all.

**The VS Code extension pins the version it suggests.** Bare `npx fathohm`
resolves a local package of that name, or a stale global install, before it
looks at the registry — so the terminal could answer with a different scorer
than the status bar had just used.

**Windows is now tested.** Half the environment allowlist below is Windows
startup state, written from documentation by people who could not run the
platform. A CI job now runs every suite that spawns git on `windows-latest` —
and found on its first run that `npm run cli:build` had never worked there at
all: `cmd.exe` does not strip `'…'`, so esbuild read the shebang banner as two
input files. The job proves the list is sufficient, not that it is minimal.

## What changed in 1.6.2

One fix, and it is about how the published file READS as much as what it does.

1.6.1 stopped handing git your whole environment, but it still found the four
`GIT_CONFIG_COUNT` variables by walking every variable on the machine and
keeping the ones that matched. Nothing else was ever copied — and a
supply-chain scanner reading the published bundle as text saw
`Object.entries(process.env)` and reported, correctly for what it can see,
that fathohm "reads your whole environment".

Now every variable git inherits is looked up by name, and the list is short
enough to print:

```
PATH                                    find the git the user's own shell runs
HOME  XDG_CONFIG_HOME                   where ~/.gitconfig lives — which is how
GIT_CONFIG_GLOBAL  GIT_CONFIG_SYSTEM    git sees the safe.directory a CI
GIT_CONFIG_NOSYSTEM                     container needs to read the repo at all
GIT_CONFIG_COUNT + the pairs it declares
USERPROFILE  HOMEDRIVE  HOMEPATH  APPDATA  LOCALAPPDATA  SYSTEMROOT
SYSTEMDRIVE  WINDIR  COMSPEC  PATHEXT  PROGRAMDATA  TEMP  TMP   (Windows)
```

Nothing else reaches git, and nothing enumerates the environment. `TZ`,
`GIT_EXEC_PATH` and `TMPDIR` were dropped in the same pass, each after a test
showed the reading does not depend on it. Note what is *not* there:
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_NAMESPACE` and
`GIT_CONFIG_PARAMETERS` — the variables that would quietly make fathohm report
a different repository or history under your repository's name.

The CLI's own output gets the same treatment: the renderer is handed the six
variables it reads (`NO_COLOR`, `FORCE_COLOR`, `COLORFGBG`, `COLUMNS`, `TERM`,
`CI`) instead of the environment.

A test asserts this about the **built bundle**, not the source: every
`process.env` in the published file is followed by a name.

## What changed in 1.6.1

Bug fixes. Two of them can change a number, and both changes make it more
accurate.

**A person named Claude is no longer read as an agent.** Signatures used to
match a substring of the author's name or email, so `Claude Dupont`, or anyone
at `precursor.io`, was labelled agent-authored and their code read as dark. A
signature must now be a whole identity the tool actually writes, such as
`noreply@anthropic.com` or `copilot-swe-agent[bot]`. The full list is in the
published methodology.

**git no longer inherits your whole environment.** Run from a git hook, the
hook's `GIT_DIR` made fathohm read the hook's repository and print it under
the target's name. git now receives only the variables it needs to find itself
and its config (`PATH`, `HOME`, git's own config variables, temp dirs, and the
Windows basics). No other environment variable reaches it.

**Smaller fixes.** `--now` and `--since` require a timezone (`Z` or `±HH:MM`),
or a bare date, which means midnight UTC. A local time used to read a
different instant on every machine. `--horizon` stops at 36500 days instead
of crashing. Pointing fathohm at a file is exit 3, not an internal error.
Grafted history is detected after `git gc` and from linked worktrees.
`explain <path>` resolves the path from where you are standing. A filename
carrying terminal control bytes prints them as `\x1b` instead of executing
them.

## What changed in 1.6.0

Nothing moved. The headline, the ledger, the exit codes and every number are
what 1.5.x printed — this release is four additions, and each one exists
because the reading was already true and could not get to where it was needed.

**`fathohm check --format markdown` — the verdict, for the place it gets
argued.** A gate failure is settled in a pull request, not in the terminal that
produced it, and getting it there meant a screenshot or a hand-typed
paraphrase. A paraphrase is where a number loses its bound, its denominator and
its limit. The markdown carries the same verdict word, the same sentence, the
canonical definition of the term, the first three dark paths and the command
that reproduces it on any clone. `--json` is unchanged; naming both at once is
a usage error rather than a silent winner.

**`--scope <dir>` — a reading of one directory.** `read`, `explain`, `fade`,
`team`, `paydown` and `offboard` take it, and it moves the DENOMINATOR: the
subtree becomes the whole reading, headline, ledger, mini-map, trend and JSON
together. Which is exactly why every scoped card states its own denominator in
the header, in a sentence, before any number:

```
Reading: lib/ — 3 files, 18K, scoped; the repository's own number is different
```

A subtree share and a repository share read identically once the flag has
scrolled off the screen, and this is the product that cannot afford a true
number about the wrong subject. **`check` refuses `--scope` outright**, with an
error that says why: its output is an exit code a pipeline acts on without
reading a word, so there is no sentence that could make a scoped verdict safe.

**`fathohm map` writes a Copy as PNG button.** The Map is the thing people
paste into a thread, and a window-cropped screenshot of it loses the headline,
the legend and the provenance. The button re-draws the page's own treemap at 2×
and puts it on the clipboard — or offers it as a download where the clipboard
API is missing, and says which before you press it. It is thirty lines of
inline script and the file stays self-contained: nothing is fetched, and
nothing is uploaded.

**`--json` carries the byte split by agent signature.** A new
`authorshipSignatures` object — `claude_code`, `copilot`, `cursor`, `unsigned`
— beside the headline on every command, so a pipeline can ask which tool wrote
the part of the codebase no human has a name on. It is data and it is never on
a card: the subject of this product is the codebase and the humans on its
record, and a vendor breakdown at card size would be a different one. The
object carries its own `note`, because the two ways to misread it are both
fatal and neither is visible from the key names: the vocabulary is three
patterns rather than a census of the field, and `unsigned` is agent-labelled
work whose commit recorded no signature — never human work. (In a git-only
reading `unsigned` is structurally zero, since the label comes FROM the
signature. It is carried at zero rather than dropped, so the shape does not
change the day a reading has another source of labels.)

A file counts once, under the newest commit that produced agent-authored
content in it. Merges are not candidates: a merge is an acceptance rather than
authorship — it wrote nothing — and letting one stand as a file's newest
declaration filed 776K of fathohm's own code as `unsigned` when its signature
had been recorded two commits earlier.

## What changed in 1.5.0

If you last ran 1.4.x, the headline moved. Worth two minutes:

**It used to be a comprehension-debt share** — the floor drawn large, the
ceiling named in the caption underneath it. Now it is the dark share, and the
debt interval is the closing block.

**Why.** Git records commits; it does not record reviews. `human_review_depth`
carries `0.40` of the score, so a git-only comprehension-debt reading is a
range rather than a number — and that range was supposed to bracket the number
the hosted product publishes for the same repository. Measured, it does not.
hono's history carries 31 merge commits in 2,137: it squash-merges almost every
pull request, and a squash-merged PR can leave nothing in the commit graph for
the ceiling to credit, so the reviews that actually happened are uncreditable
here and the hosted number can land outside the interval entirely. Two numbers
for one repository, in the same units, with the same word beside them, and no
rule a reader could apply to reconcile them — on the one surface whose whole
argument is *run it yourself*.

So the CLI stopped competing with the hosted number and started answering the
question git can actually close.

What that moved, concretely:

- **`BELOW THE LINE` is now `GONE DARK`**, cut on a different predicate: no
  human wrote or prompted the file inside the window, rather than a score under
  the line. Different headings, and no score column on a row.
- **`fathohm explain <n>` numbers the dark list**, in the order the card prints
  it. `explain 3` is the third file of `GONE DARK`, not of a below-the-line
  list.
- **The comprehension-debt interval is demoted**, not deleted: it closes the
  card as two labelled readings, with the trend strip under the heading that
  names the quantity it plots.
- **The card's leverage line is gone.** It used to close the file list with
  *"a recorded, commented review of the 5 files above re-scores this repo …"*.
  A review does not make a file lit — recency is a fact about who authored it —
  so the line recommended work that provably could not move the number printed
  above it. The counterfactual still exists, in `fathohm paydown`, against the
  number it does move.
- **The metaphor word beside the big number is retired.** Every card that used
  to wear a nautical label for the debt now prints `comprehension debt`, the
  plain term, in the block that carries it.
- **`check`, `fade`, `paydown` and `offboard` did not change.** They still
  speak in comprehension debt and the 0.30 line, because a gate, a forecast, a
  ladder and a handover are all questions about the score.
