export function adminUsername(value) {
  const name = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name))
    throw new Error(
      "Usa entre 3 y 32 letras, números, puntos o guiones para tu usuario.",
    );
  return name;
}
// Internal Auth identifier only; the administrator never needs an email address.
export const adminAlias = (value) =>
  `${adminUsername(value)}@admin.nupcial.invalid`;
