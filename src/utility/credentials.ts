/** Rules for local (username + password) logins, shared by registration, the profile page and admins.
 * @module utility/credentials
 */

export const USERNAME_RULE = /^[A-Za-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN = 8;
/** bcrypt only uses the first 72 bytes of a password. */
export const PASSWORD_MAX = 72;

/** What's wrong with a username, or null when it's fine. */
export function usernameProblem(username: unknown): string | null {
  if (typeof username !== "string" || !USERNAME_RULE.test(username)) {
    return "Usernames are 3 to 32 characters: letters, digits, dot, dash or underscore.";
  }
  return null;
}

/** What's wrong with a password, or null when it's fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return `Passwords need at least ${PASSWORD_MIN} characters.`;
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX) {
    return `Passwords can be at most ${PASSWORD_MAX} bytes long.`;
  }
  return null;
}
