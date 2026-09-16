// lib/code-files.ts
//
// The single source of truth for "is this path CODE?" Comprehension debt is a
// property of code, not of the binary assets, media, fonts, lockfiles, PROSE
// DOCUMENTS and GENERATED FILES that happen to share the repo tree. joinRows in
// lib/map-tree.ts filters through this one predicate, so the Map, the headline,
// the riskiest table, and the weekly digest can never disagree about what counts.
//
// A README is written to be read, so "no human has read it lately" is not the
// same claim about it that it is about a parser — and a file whose name declares
// it was generated has no hand to have written it. Neither belongs in the roster
// the headline counts. Both still exist: this is a DISPLAY-time filter only, the
// event spine still records every file's history, so widening or narrowing the
// list re-values every reading without any re-ingestion.
//
// Pure and deterministic. Default is TRUE: anything not on a denylist is code,
// so extensionless files like Dockerfile and Makefile stay in.

// Generated files denied by exact (case-insensitive) final-segment filename —
// the ones whose names a pattern cannot express. Lockfiles that simply end in
// `.lock` are handled as an extension below, NOT enumerated here.
//
// This list used to carry every `.lock` name one by one, on the reasoning that
// a `.lock` suffix rule "would over-deny legitimately hand-written files". No
// such file was ever named, and the enumeration failed exactly the way a name
// list fails: Bun renamed its lockfile `bun.lockb` -> `bun.lock` in 1.2, the
// list still held only the old name, and hono's 274 KB `bun.lock` was scored as
// code — the largest cell in the most public Map Fathohm serves, with
// `benchmarks/routers/bun.lock` ranked its #1 riskiest path, on a page whose own
// copy says lockfiles "are excluded throughout". A tool can rename its lockfile;
// it cannot stop the file being generated. So the CLASS is denied, and only the
// names outside that class are listed.
const DENIED_FILENAMES = new Set<string>([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "bun.lockb",
  "go.sum",
  "gradle.lockfile",
  "packages.lock.json",
  // Swift Package Manager's lockfile. Generated, and the only mainstream one
  // whose name carries neither `lock` nor a denied extension.
  "package.resolved",
  ".ds_store",
  // Written by `next dev`/`next build` on every run, and git-tracked by
  // convention. `.d.ts` cannot be denied as a class — hand-written ambient
  // declarations are code — so the one generated file with a fixed name is
  // denied by that name.
  "next-env.d.ts",
]);

/**
 * Prose extensions, named separately because one consumer needs to tell prose
 * from the rest of the denial set.
 *
 * `isCodeFile` only ever answers code / not-code, and for its own purpose that
 * is the right shape: a PNG and a README are equally not the subject of a
 * comprehension score. The dark index needs the finer split for REPORTING, not
 * for deciding: each row carries its prose bytes beside its code bytes, so a
 * reader can see that a repository near the top of GitHub by stars is mostly
 * documentation without the index having formed an opinion about it.
 *
 * It is deliberately NOT a qualifying rule. An earlier draft admitted a
 * repository to the index only if code outweighed prose; that filter is gone,
 * because a content predicate lets the index quietly decide which repositories
 * count and a selection rule that can be tuned is a number nobody has to
 * believe. Repositories are taken in star order and a repository with no code
 * files simply has nothing to measure — which `noReading` says in those words,
 * in the published row, rather than by silently dropping it.
 *
 * Exported rather than re-listed there on purpose. A second copy of this list
 * living in a script is a second taxonomy, and the moment the two disagree the
 * index is describing repositories by one definition of prose and scoring them
 * by another.
 */
export const PROSE_EXTENSIONS = ["md", "mdx", "markdown", "rst", "adoc", "asciidoc"] as const;

/** True when `path`'s final segment ends in a known prose extension. */
export function isProseFile(path: string): boolean {
  const segment = path.split("/").pop()?.toLowerCase() ?? "";
  const dot = segment.lastIndexOf(".");
  if (dot <= 0) return false;
  return (PROSE_EXTENSIONS as readonly string[]).includes(segment.slice(dot + 1));
}

// Denied by the final `.ext` of the segment (case-insensitive).
const DENIED_EXTENSIONS = new Set<string>([
  // images
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "tif", "avif", "heic", "svg",
  // media
  "mp4", "mov", "webm", "avi", "mkv", "m4v", "mp3", "wav", "ogg", "flac", "m4a",
  // fonts
  "woff", "woff2", "ttf", "otf", "eot",
  // archives
  "zip", "gz", "tgz", "tar", "bz2", "xz", "7z", "rar", "jar",
  // binaries / other
  "pdf", "exe", "dll", "so", "dylib", "wasm", "bin", "dat", "db", "sqlite", "psd", "ai", "sketch",
  // prose. A README, a design doc and a changelog are written to be READ, and
  // "this has not been touched in eight months" is not a debt about them the
  // way it is about a parser. They were inflating the denominator of a number
  // whose whole subject is code.
  ...PROSE_EXTENSIONS,
  // Lockfiles, as a class. Resolved dependency graphs written by a package
  // manager: yarn, cargo, poetry, uv, pipenv, composer, bundler, nix, bun (>=1.2),
  // deno, pdm, mix, cocoapods, pub. Nobody hand-writes one, and "no human has
  // recently reviewed this" is not a debt about a file no human authored.
  "lock",
  // Environment files in their `production.env` spelling — the `.env` and
  // `.env.local` spellings carry no extension to deny by and are handled in
  // `isCodeFile` itself. See the paragraph there.
  "env",
  // NOT "txt", deliberately. CMakeLists.txt is build code and requirements.txt
  // is a dependency manifest — the extension is carried by real source in
  // enough ecosystems that denying it would lose code to gain notes.
]);

// Suffix denials that a single-extension check can't express: minified bundles,
// sourcemaps, and the `.gen.` convention. `.map` is matched as a suffix (not
// extension "map") so a file like map-tree.ts or Map.tsx is never mistaken for
// a sourcemap.
const DENIED_SUFFIXES = [
  ".min.js",
  ".min.css",
  ".map",
  ".gen.ts",
  ".gen.tsx",
  ".gen.js",
  ".gen.jsx",
];

// Denied when the final segment CONTAINS the marker, at any position: the
// `api.generated.ts` / `client.generated.go` convention puts it before the
// extension rather than at the end, so a suffix rule would need one entry per
// language. These names declare generation in the name itself — the only
// generation signal available without reading file contents, which this
// codebase never does.
const DENIED_INFIXES = [".generated."];

/**
 * True when `path` should be treated as code. Default TRUE; a path is denied
 * only when its final segment is a known lockfile, is a dotenv file, ends in a
 * known non-code extension, matches a known non-code suffix, or carries a
 * generation marker inside the name. Case-insensitive.
 *
 * Only the FINAL SEGMENT is ever examined. A directory called
 * `generated-reports/` says something about where a file sits, not about how it
 * was written, and hand-written code lives under directories with every name.
 */
export function isCodeFile(path: string): boolean {
  const name = (path.split("/").filter((s) => s.length > 0).at(-1) ?? "").toLowerCase();
  if (name === "") return true;

  if (DENIED_FILENAMES.has(name)) return false;

  // ENVIRONMENT FILES, as a class: `.env`, `.env.local`,
  // `.env.production.local`, whatever the next framework invents. A dotenv file
  // is configuration and credentials — `KEY=value` lines a process reads at
  // boot — and "no human has recently written, reviewed or explained it" is not
  // a debt about one. It was scoring as code for a structural reason rather
  // than a considered one: `.env` has no extension to deny by, because the
  // leading dot IS the whole name, so the extension check below never sees it.
  //
  // It is denied HERE rather than by another entry in DENIED_FILENAMES for the
  // same reason `.lock` is a class: the suffixes multiply per framework
  // (`.env.test`, `.env.staging.local`) and a name list would be one release
  // behind whichever tool added the next one.
  //
  // `.envrc` stays IN. direnv's file is a shell script, and a shell script is
  // code — the rule is the dotenv NAME, not the three letters.
  if (name === ".env" || name.startsWith(".env.")) return false;

  for (const suffix of DENIED_SUFFIXES) {
    if (name.endsWith(suffix)) return false;
  }

  for (const infix of DENIED_INFIXES) {
    if (name.includes(infix)) return false;
  }

  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const ext = name.slice(dot + 1);
    if (DENIED_EXTENSIONS.has(ext)) return false;
  }

  return true;
}
