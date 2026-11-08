/** The name an account gets when nobody told us one: its email's first part, capitalised (jane.doe@x.com -> "Jane doe"). */
export function fallbackName(email: string): string {
  const raw = (email.split('@')[0] ?? '').replace(/[._-]+/g, ' ').trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Me';
}
