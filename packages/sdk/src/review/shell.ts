/** A shell argument, quoted when it is not a plain token. */
export function shellArg(value: string) {
  return /^[A-Za-z0-9_./:@+,-]+$/.test(value)
    ? value
    : `"${value.replace(/["\\$`]/g, '\\$&')}"`
}
