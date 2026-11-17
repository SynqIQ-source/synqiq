import { cleanText, normalizeEmail, normalizePhone } from "@/lib/crm/normalize";

// Validates equipment and vendor forms (Club Admins). Returns the columns
// to save, or an error.

export function equipmentValues(body: Record<string, unknown> | null) {
  const name = cleanText(body?.name, 120);
  if (!name) return { ok: false as const, error: "Name the equipment." };
  const id = (value: unknown) => (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null);
  return {
    ok: true as const,
    values: {
      name,
      area: cleanText(body?.area, 120),
      model_number: cleanText(body?.modelNumber, 120),
      serial_number: cleanText(body?.serialNumber, 120),
      is_critical: body?.isCritical === true,
      owner_staff_id: id(body?.ownerStaffId),
      default_vendor_id: id(body?.defaultVendorId),
      notes: typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null,
    },
  };
}

export function vendorValues(body: Record<string, unknown> | null) {
  const name = cleanText(body?.name, 120);
  if (!name) return { ok: false as const, error: "Add the vendor's company name." };
  const rawEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const rawPhone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawEmail && !email) return { ok: false as const, error: "That email doesn't look right." };
  if (rawPhone && !phone) return { ok: false as const, error: "That phone number doesn't look right." };
  if (!email && !phone) return { ok: false as const, error: "Add an email or a phone number." };
  return {
    ok: true as const,
    values: {
      name,
      contact_name: cleanText(body?.contactName, 120),
      email,
      phone,
      notes: typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null,
    },
  };
}
