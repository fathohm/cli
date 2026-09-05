/**
 * THE ONE URL fathohm ever prints.
 *
 * It lives alone in its own module because it is quoted on three surfaces —
 * the card's closing line, the HTML map's footer, and (as the sole allowed
 * match) the no-network assertion that greps the bundle for anything that
 * looks like a network address. A constant restated in three files is a
 * constant that will be right in two of them.
 *
 * `fathohm.dev` is the canonical site: it is the URL the Show HN submission
 * points at, the one the launch thread prints, the home of the
 * comprehension-debt essay, and the domain the product's own address
 * (hello@fathohm.dev) is on. Nothing here fetches it — it is a string in a
 * sentence, and the CLI has no network code to fetch it with.
 */
export const HOSTED_URL = "https://fathohm.dev";
