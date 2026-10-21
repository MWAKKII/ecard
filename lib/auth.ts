import bcrypt from "bcryptjs";

// Scrambles a plain text password to store in database
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

// Checks if an entered password matches the stored scrambled password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

/**
 * Input validation for authentication forms (Step 4).
 * Returns an error message, or null when the input is valid.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email: unknown): string | null {
  if (typeof email !== "string" || !email.trim()) {
    return "Email address is required.";
  }
  const value = email.trim();
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) {
    return "Please enter a valid email address.";
  }
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || !password) {
    return "Password is required.";
  }
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (password.length > 200) {
    return "Password must be 200 characters or fewer.";
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

/** Normalizes an email for storage/comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
