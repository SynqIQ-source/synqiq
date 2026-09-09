// The identity the member sees on a follow-up: "<Instructor first name> at
// <Studio name>". Deliberately NOT stored on the conversation row -- it is
// re-derived on every send (outbound and relayed inbound) from
// staff.first_name + organizations.name, so a studio rename or a corrected
// staff name flows through without a migration.
export function deriveFollowupDisplayName(instructorFirstName: string, organizationName: string): string {
  const first = instructorFirstName.trim().split(/\s+/)[0] || instructorFirstName.trim();
  return `${first} at ${organizationName}`;
}

// RFC 5322 display names containing anything outside a narrow safe set must
// be quoted, and a literal `"` or `\` inside must be escaped. Keeps a stray
// comma or "at" studio name from breaking the header.
export function formatAddress(displayName: string, email: string): string {
  const needsQuoting = /[^A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~]/.test(displayName);
  if (!needsQuoting) {
    return `${displayName} <${email}>`;
  }
  const escaped = displayName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}" <${email}>`;
}
