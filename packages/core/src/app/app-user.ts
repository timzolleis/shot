/** `--as admin` with users { admin: admin@example.org } → admin@example.org; an email or unknown name stays (D15). */
export const userFromAlias = ({
  as,
  users,
}: {
  readonly as: string
  readonly users: Readonly<Record<string, string>>
}): string => users[as] ?? as

/** Session files and locks are per (app host, user, params) (D14). */
export const appSessionKey = ({
  host,
  user,
  params,
}: {
  readonly host: string
  readonly user: string
  readonly params: Readonly<Record<string, string>>
}): string => {
  const slug = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9@.]+/g, '-')
  const paramsPart = Object.keys(params)
    .sort()
    .map((name) => `${slug(name)}=${slug(params[name] ?? '')}`)
    .join(',')
  return `${host}/${slug(user)}--${paramsPart === '' ? 'default' : paramsPart}`
}
