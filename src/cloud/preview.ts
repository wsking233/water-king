/** UI opt-in only; all Auth and database authorization remains server-side. */
export function emailPreviewEnabled(buildFlag: string | undefined, search: string) {
  return buildFlag === "true" || new URLSearchParams(search).get("email-preview") === "1";
}
