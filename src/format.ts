/**
 * Date formatting, in the user's locale.
 *
 * Every timestamp from VIM Server is an ISO 8601 string. A value the browser
 * cannot parse is shown exactly as it arrived rather than as "Invalid Date":
 * a sample app should not hide a server that sent something unexpected.
 */

function parse(iso: string): Date | undefined {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Date and time, e.g. for a snapshot's exact creation moment in a tooltip. */
export function formatDateTime(iso: string): string {
  return parse(iso)?.toLocaleString() ?? iso
}

/** Date only, for lists where the time of day adds nothing. */
export function formatDate(iso: string): string {
  return parse(iso)?.toLocaleDateString() ?? iso
}
