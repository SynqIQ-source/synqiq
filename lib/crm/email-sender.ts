// "Name <a@b.com>" or "a@b.com" -> "a@b.com", lowercased.
export function bareEmail(address: string): string {
  const angle = address.match(/<([^>]+)>/);
  return (angle ? angle[1]! : address).trim().toLowerCase();
}

// The sender of a guest email reply when it isn't the guest's email on file
// (null when it is). Kept on the message so the thread shows who wrote it.
export function otherSender(from: string, emailOnFile: string | null): string | null {
  const sender = bareEmail(from);
  if (!sender) return null;
  return sender === (emailOnFile ?? "").trim().toLowerCase() ? null : sender.slice(0, 320);
}
