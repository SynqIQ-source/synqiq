import { createHash, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { agreementTitle, dollars, fillAgreement } from "@/lib/agreements/render";
import { buildAgreementPdf } from "@/lib/agreements/pdf";

// Agreements at checkout: which items in a sale need one, the filled-in text
// the buyer reads, and saving what they signed (text, signature, PDF).

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const BUCKET = "crm-private";

export type AgreementToSign = {
  lineIndex: number; // index into the sale's lines
  itemId: string;
  itemName: string;
  templateId: string;
  templateVersion: number;
  title: string;
  body: string;
  sha256: string;
};

export type AgreementSignatureRequest = {
  lineIndex: number;
  sha256: string;
  signerName: string;
  method: "drawn" | "typed";
  signature: string | null; // PNG data URL when drawn
  agreed: boolean;
};

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export async function agreementsForSale(
  admin: Admin,
  organizationId: string,
  input: {
    memberName: string | null;
    timezone: string;
    lines: {
      lineIndex: number;
      itemId: string;
      itemName: string;
      templateId: string | null;
      sessions: number | null;
      quantity: number;
      firstPaymentCents: number; // this line, after discounts, before tax
      monthlyDuesCents: number | null;
    }[];
  },
): Promise<AgreementToSign[]> {
  const needing = input.lines.filter((line) => line.templateId);
  if (!needing.length) return [];
  const [{ data: org }, { data: templates }] = await Promise.all([
    admin.from("organizations").select("name, legal_name").eq("id", organizationId).maybeSingle(),
    admin
      .from("agreement_templates")
      .select("id, body, version, active")
      .eq("organization_id", organizationId)
      .in("id", [...new Set(needing.map((line) => line.templateId!))]),
  ]);
  const templateBy = new Map((templates ?? []).filter((row) => row.active).map((row) => [row.id as string, row]));
  const businessName = (org?.legal_name as string | null) ?? (org?.name as string | null) ?? "The studio";
  const today = DateTime.now().setZone(input.timezone).toFormat("LLLL d, yyyy");
  const result: AgreementToSign[] = [];
  for (const line of needing) {
    const template = templateBy.get(line.templateId!);
    if (!template) continue;
    const body = fillAgreement(template.body as string, {
      business_name: businessName,
      member_name: input.memberName ?? undefined,
      item: line.itemName,
      monthly_dues: line.monthlyDuesCents == null ? undefined : dollars(line.monthlyDuesCents),
      first_payment: dollars(line.firstPaymentCents),
      sessions: line.sessions == null ? undefined : String(line.sessions * line.quantity),
      date: today,
    });
    const title = agreementTitle(line.itemName);
    result.push({
      lineIndex: line.lineIndex,
      itemId: line.itemId,
      itemName: line.itemName,
      templateId: template.id as string,
      templateVersion: Number(template.version),
      title,
      body,
      sha256: sha256(`${title}\n\n${body}`),
    });
  }
  return result;
}

function decodePng(dataUrl: string | null): Uint8Array | null {
  if (!dataUrl) return null;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match || match[1].length > 2_000_000) return null;
  const bytes = Buffer.from(match[1], "base64");
  // PNG magic number
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  return new Uint8Array(bytes);
}

// Every agreement needs a matching, complete signature; returns the problem
// (shown at checkout) or null.
export function signatureProblem(needed: AgreementToSign[], signed: AgreementSignatureRequest[]): string | null {
  for (const agreement of needed) {
    const signature = signed.find((row) => row.lineIndex === agreement.lineIndex);
    if (!signature) return `The member needs to sign the ${agreement.title}.`;
    if (signature.sha256 !== agreement.sha256)
      return `The sale changed after the ${agreement.title} was signed. Have the member sign again.`;
    if (!signature.agreed) return `The member needs to agree to the ${agreement.title}.`;
    if (signature.signerName.trim().length < 2) return `Type the signer's full name for the ${agreement.title}.`;
    if (signature.method === "drawn" && !decodePng(signature.signature))
      return `The member needs to sign in the box for the ${agreement.title}.`;
  }
  return null;
}

// Saves the signed agreements for a saved sale. Throws on failure (the
// caller removes the sale so nothing is half-saved).
export async function saveSignatures(
  admin: Admin,
  context: {
    organizationId: string;
    timezone: string;
    saleId: string;
    saleNumber: number;
    mindbodyClientId: string | null;
    crmContactId: string | null;
    clientName: string | null;
    staffId: string;
    staffName: string | null;
    ip: string | null;
    userAgent: string | null;
  },
  needed: AgreementToSign[],
  signed: AgreementSignatureRequest[],
) {
  if (!needed.length) return;
  const { data: org } = await admin.from("organizations").select("name, legal_name").eq("id", context.organizationId).maybeSingle();
  const businessName = (org?.legal_name as string | null) ?? (org?.name as string | null) ?? "The studio";
  const now = DateTime.now();
  const uploaded: string[] = [];
  try {
    const rows = [];
    for (const agreement of needed) {
      const signature = signed.find((row) => row.lineIndex === agreement.lineIndex)!;
      const id = randomUUID();
      const folder = `${context.organizationId}/agreements/${id}`;
      const png = signature.method === "drawn" ? decodePng(signature.signature) : null;
      const signerName = signature.signerName.trim().slice(0, 200);
      const pdf = await buildAgreementPdf({
        businessName,
        title: agreement.title,
        body: agreement.body,
        bodySha256: agreement.sha256,
        templateVersion: agreement.templateVersion,
        memberName: context.clientName ?? signerName,
        signerName,
        method: signature.method,
        signaturePng: png,
        saleNumber: context.saleNumber,
        signedAtLocal: now.setZone(context.timezone).toFormat("LLL d, yyyy, h:mm:ss a ZZZZ"),
        signedAtUtc: now.toUTC().toISO()!,
        staffName: context.staffName,
        ip: context.ip,
        userAgent: context.userAgent,
        signatureId: id,
      });
      if (png) {
        const { error } = await admin.storage.from(BUCKET).upload(`${folder}/signature.png`, png, { contentType: "image/png" });
        if (error) throw error;
        uploaded.push(`${folder}/signature.png`);
      }
      const { error } = await admin.storage.from(BUCKET).upload(`${folder}/agreement.pdf`, pdf, { contentType: "application/pdf" });
      if (error) throw error;
      uploaded.push(`${folder}/agreement.pdf`);
      rows.push({
        id,
        organization_id: context.organizationId,
        template_id: agreement.templateId,
        template_version: agreement.templateVersion,
        sale_id: context.saleId,
        pos_item_id: agreement.itemId,
        item_name: agreement.itemName,
        mindbody_client_id: context.mindbodyClientId,
        crm_contact_id: context.crmContactId,
        client_name: context.clientName,
        title: agreement.title,
        body: agreement.body,
        body_sha256: agreement.sha256,
        signer_name: signerName,
        method: signature.method,
        signature_path: png ? `${folder}/signature.png` : null,
        pdf_path: `${folder}/agreement.pdf`,
        signed_at: now.toUTC().toISO()!,
        staff_id: context.staffId,
        ip: context.ip?.slice(0, 100) ?? null,
        user_agent: context.userAgent?.slice(0, 400) ?? null,
      });
    }
    const { error } = await admin.from("agreement_signatures").insert(rows);
    if (error) throw error;
  } catch (error) {
    if (uploaded.length) await admin.storage.from(BUCKET).remove(uploaded);
    throw error;
  }
}

// A signed agreement's PDF bytes, scoped to the studio (and to one member
// when clientId is given). Null when it isn't theirs.
export async function signedAgreementPdf(admin: Admin, organizationId: string, id: string, clientId?: string) {
  let query = admin.from("agreement_signatures").select("pdf_path, title, client_name").eq("id", id).eq("organization_id", organizationId);
  if (clientId) query = query.eq("mindbody_client_id", clientId);
  const { data } = await query.maybeSingle();
  if (!data) return null;
  const { data: file, error } = await admin.storage.from(BUCKET).download(data.pdf_path as string);
  if (error || !file) return null;
  const filename = `${data.title as string}${data.client_name ? ` - ${data.client_name as string}` : ""}`
    .replace(/[^A-Za-z0-9 ()-]+/g, "")
    .trim();
  return { bytes: new Uint8Array(await file.arrayBuffer()), filename: `${filename || "Agreement"}.pdf` };
}
