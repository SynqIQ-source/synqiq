# synqiq.co reputation remediation pack

Internal working doc. Do not deploy or move into `public/`.

Prepared 2026-10-14. Goal: get `synqiq.co` / `www.synqiq.co` reclassified from
"phishing" (and ESET "suspicious") to Business / Software-as-a-Service.

## Before submitting

Verified live on 2026-10-14:

- `https://synqiq.co/` returns 200 and shows the public landing page, with no password field.
- `/privacy`, `/terms`, `/robots.txt`, `/sitemap.xml`, `/.well-known/security.txt` and `/favicon.ico` all return 200.
- `https://www.synqiq.co/*` returns a 308 redirect to `https://synqiq.co/*`.
- The `<title>`, meta description and canonical tag are inside `<head>` for all user agents.

DNS: DMARC record added and confirmed live on 2026-10-14 (see the section at the end).

After each vendor confirms a fix, click **Reanalyze** on the VirusTotal URL report.
VirusTotal does not change vendor verdicts itself, so the vendors' changes only show
up after a fresh scan.

### Common facts (the only claims used in the texts below)

- SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX.
- Built with Next.js, hosted on Vercel, with Supabase authentication.
- Collects no payment information.
- Does not imitate any other brand or ask for credentials to other services.
- "SynqIQ" is the product's brand name, not an algorithmically generated domain.
- The site has a public landing page, privacy policy, terms, and security.txt.
- Requested category: Business / Software-as-a-Service.
- Hostnames: `synqiq.co`, `www.synqiq.co`.
- Contact: adam@thepreservehouston.com.

### Confirmation key

- **Confirmed**: I read it on the vendor's own page.
- **VT-listed**: taken from VirusTotal's official list of vendor false-positive contacts
  (https://docs.virustotal.com/docs/false-positive-contacts), but not confirmed on the
  vendor's own site.
- **Unconfirmed**: I couldn't verify it. Treat it with care.

---

## 1. Fortinet (FortiGuard)

**Links (confirmed on fortiguard.com):**
- Malicious-URL appeal. Use this first, because the flag is "phishing": https://www.fortiguard.com/faq/malurl
- Category rating change: https://www.fortiguard.com/faq/wfratingsubmit
- Lookup and "Request a Review" page: https://www.fortiguard.com/webfilter

**Fields (from the vendor page):**
- **Malicious-URL appeal**
  - Required: URL, Name, Email, Company Name.
  - Optional: Comment.
- **Rating change**
  - Required: URL, Suggest a category, Name, Email, Company Name.
  - Optional: screenshot (2 MB max), Comment.

**Category to pick:** "Business". "Information Technology" or "Web-based Applications"
are acceptable alternatives.

**Account, CAPTCHA, verification:** none mentioned on the vendor page. The live form may
still show a CAPTCHA.

**Plan:** Submit both forms, once for `synqiq.co` and once for `www.synqiq.co`.

**Comment text:**

> Requesting review of synqiq.co and www.synqiq.co, currently flagged as phishing. SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX. It is built with Next.js, hosted on Vercel, and uses Supabase authentication. The site collects no payment information, does not imitate any other brand, and does not ask for credentials to any other service. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site now has a public landing page, a privacy policy (https://synqiq.co/privacy), terms (https://synqiq.co/terms), and https://synqiq.co/.well-known/security.txt. Please reclassify as Business / Software-as-a-Service. Contact: adam@thepreservehouston.com

---

## 2. Forcepoint (ThreatSeeker)

**Links:**
- Site lookup and recategorization: https://support.forcepoint.com/s/site-lookup
  - **Confirmed**: Forcepoint's "Blocked by Forcepoint" page
    (https://www.forcepoint.com/company/blocked-by-forcepoint) points site owners here.
  - **Unusual:** it is a Forcepoint Hub (Salesforce) page and loads a login flow, so it
    probably needs a Forcepoint account. I couldn't confirm whether guests can submit.
- Email: `reviewmysite@forcepoint.com` (**VT-listed**). No account needed, so use this if
  the Hub asks you to sign in.

**Fields:** none documented for email. On the Hub tool you enter the URL, then suggest a
category and give a reason.

**Category to request:** Business and Economy, or Information Technology.

**Email subject:** `Recategorization request: synqiq.co (false positive - phishing)`

**Email body:**

> Hello Forcepoint team,
>
> Please review synqiq.co and www.synqiq.co, which are currently categorized as phishing.
>
> SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX. It is built with Next.js, hosted on Vercel, and uses Supabase authentication. The site collects no payment information, does not imitate any other brand, and does not ask for credentials to any other service. "SynqIQ" is the product's brand name, not an algorithmically generated domain.
>
> The site has a public landing page (https://synqiq.co/), a privacy policy (https://synqiq.co/privacy), terms (https://synqiq.co/terms), and https://synqiq.co/.well-known/security.txt.
>
> Requested category: Business / Software-as-a-Service.
>
> Thank you,
> [your name]
> adam@thepreservehouston.com

---

## 3. Webroot / BrightCloud (OpenText)

**Link (confirmed):** https://support.threatintel.opentext.com/tools/change-request.php

`brightcloud.com/tools/change-request.php` now redirects (301) to this address.

**Fields:**
- Required: "URL or IP", "Your email".
- Optional:
  - The checkbox "I would like to suggest a category for this URL", which opens a
    category list.
  - "Your product/integration".
  - "Additional comments".

**Unusual: the comment box has a 150-character limit.**

**Category to pick:** "Business and Economy". "Computer and Internet Info" is also
acceptable. There is no SaaS category. The list includes "Phishing and Other Frauds",
which is presumably the current one.

**Account, CAPTCHA, verification:** none mentioned.

**Plan:** Submit `synqiq.co` and `www.synqiq.co` as two separate requests.

**Product/integration field:** leave blank, or write "VirusTotal".

**Comment (147 characters):**

> SynqIQ: staff scheduling & substitute-coverage SaaS for a Houston, TX fitness facility. Brand name, not DGA. No payments; no credential harvesting.

---

## 4. Sophos

**Links:**
- Email: `samples@sophos.com`
  - **VT-listed**.
  - Sophos community posts also say anyone may send suspicious or misclassified URLs here.
- Web form: Sophos documents a "Submit a Sample" page with a **Web Address (URL)** option.
  - **Unconfirmed:** the old link (`secure.sophos.com/support/samples`) now redirects to
    the Sophos homepage, and the current support pages wouldn't render for me.
- Intelix portal: https://intelix.sophos.com/
  - Signing in with a Sophos ID lets you escalate a verdict for human review, which is
    optional.
  - **Unusual:** it needs a free Sophos ID account.

**Plan:** use the email path, which needs no account.

**Email subject:** `False positive URL reassessment: synqiq.co`

**Email body:**

> Hello SophosLabs,
>
> Please reassess the following URLs, which are flagged as phishing:
> https://synqiq.co/
> https://www.synqiq.co/
>
> SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX. It is built with Next.js, hosted on Vercel, and uses Supabase authentication. The site collects no payment information, does not imitate any other brand, and does not ask for credentials to any other service. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site has a public landing page, privacy policy, terms, and security.txt.
>
> Requested category: Business / Software-as-a-Service.
>
> Thank you,
> [your name]
> adam@thepreservehouston.com

---

## 5. Bitdefender

**Links:**
- False-positive form: https://www.bitdefender.com/consumer/support/answer/29358/
  - This is the URL Bitdefender staff give in their community forums.
  - The page returned 403 to my fetches, so I couldn't read its fields.
- Email: `virus_submission@bitdefender.com` (**VT-listed**).

**Fields (unconfirmed):** forum guidance says to choose **"false positive"** in the form's
dropdown.

**Turnaround (Bitdefender's own wording in its forum answers):** false positives are
removed within 72 hours. If the detection is still there after 72 hours, Bitdefender's
decision stands.

**Plan:** Try the form first. If it needs anything unexpected, email instead.

**Email subject:** `False positive: synqiq.co`

**Form or email text:**

> False positive report for https://synqiq.co/ and https://www.synqiq.co/ (flagged as phishing).
>
> SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX. It is built with Next.js, hosted on Vercel, and uses Supabase authentication. The site collects no payment information, does not imitate any other brand, and does not ask for credentials to any other service. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site has a public landing page, privacy policy (https://synqiq.co/privacy), terms (https://synqiq.co/terms), and security.txt.
>
> Requested category: Business / Software-as-a-Service. Contact: adam@thepreservehouston.com

---

## 6. ESET (marked "suspicious")

**Link (confirmed, ESET KB141):** email `samples@eset.com`.

https://support.eset.com/en/kb141-submit-a-virus-website-or-potential-false-positive-sample-to-the-eset-lab

**Required format (from KB141):**
- The subject must start with `Domain whitelist` followed by the domain.
- In the body, give the URL, say why it's a false positive, and give source information.
- A screenshot is recommended if you have one.
- If nothing changes after 3 days, send a follow-up with the original subject, date and
  time, and the sender address.

**Note:** I've kept the body plain text with only the URLs being reported. Common
guidance for ESET submissions is to avoid extra links, images and signatures.

**Subject:** `Domain whitelist synqiq.co`

**Body:**

> Blocked/flagged URLs:
> https://synqiq.co/
> https://www.synqiq.co/
>
> Why this is a false positive: SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX. It is built with Next.js, hosted on Vercel, and uses Supabase authentication. The site collects no payment information, does not imitate any other brand, and does not ask for credentials to any other service. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site has a public landing page, privacy policy, terms, and security.txt.
>
> Source: SynqIQ (web application). Requested category: Business / Software-as-a-Service.
>
> Contact: adam@thepreservehouston.com

---

## 7. G Data

**Link (confirmed):** G Data's help page
(https://www.gdata.de/help/en/general/GeneralInformation/submitFileAppURL/) links to
https://su.gdatasoftware.com/url-submission. That address redirects to
https://submit.gdatasoftware.com/url.

**Fields (partly confirmed):**
- A required consent checkbox ("I expressly agree to these conditions").
- A choice between false positive and false negative. Choose **False positive**.
- I couldn't read the rest of the form fields.

**Note from G Data:** a ticket is created, and an analyst replies with a verdict.

**Text:**

> False positive: https://synqiq.co/ and https://www.synqiq.co/ are flagged as phishing. SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX (Next.js on Vercel, Supabase authentication). It collects no payment information, does not imitate any other brand, and does not ask for credentials to other services. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site has a public landing page, privacy policy, terms, and security.txt. Requested category: Business / Software-as-a-Service. Contact: adam@thepreservehouston.com

---

## 8. VIPRE

**Link:** https://helpdesk.vipre.com/hc/en-us/requests/new (**VT-listed**).

**Unconfirmed:**
- VIPRE's helpdesk blocked my fetch (403), so I couldn't see the fields or whether
  sign-in is required.
- It's a Zendesk "new request" form, which sometimes needs an account or an email
  confirmation.
- A third-party guide cites `vipre.com/support/submit-false-positive`, but that address
  now just redirects to `vipre.com/support/`. I couldn't confirm it.

**Fields (expected):** your email, subject, description, and possibly a request-type
dropdown. Pick the false-positive or website option if there is one.

**Subject:** `False positive - website flagged as phishing: synqiq.co`

**Description:**

> Please review https://synqiq.co/ and https://www.synqiq.co/, flagged as phishing on VirusTotal. SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX. It is built with Next.js, hosted on Vercel, and uses Supabase authentication. It collects no payment information, does not imitate any other brand, and does not ask for credentials to other services. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site has a public landing page, privacy policy, terms, and security.txt. Requested category: Business / Software-as-a-Service. Contact: adam@thepreservehouston.com

---

## 9. alphaMountain.ai

**Links:**
- Official false-positive page (confirmed): https://www.alphamountain.ai/false-positive/
  - It links to a Freshdesk ticket form, https://alphamountain.freshdesk.com/support/tickets/new.
  - **Unusual: that form redirects to a Freshdesk login, so it needs an account.**
- Email: `support@alphamountain.ai` (**VT-listed**). No account needed, so use this.
  Freshdesk portals usually turn incoming email into a ticket.

**Note from alphaMountain:** requests are processed in the order received.

**Email subject:** `False positive / classification dispute: synqiq.co`

**Email body:**

> Hello alphaMountain team,
>
> Please review the classification of synqiq.co and www.synqiq.co, which are flagged as phishing.
>
> SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX. It is built with Next.js, hosted on Vercel, and uses Supabase authentication. The site collects no payment information, does not imitate any other brand, and does not ask for credentials to any other service. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site has a public landing page, privacy policy, terms, and security.txt.
>
> Requested category: Business / Software-as-a-Service.
>
> Thank you,
> [your name]
> adam@thepreservehouston.com

---

## 10. Lionic

**Links:**
- Official page: https://www.lionic.com/supports/report-false-positive/
  - It currently has no form, only a "Get in touch" button to https://www.lionic.com/contact.
- Email: `support@lionic.com` (**VT-listed**).
- A search result quoted an older Lionic FAQ saying URL false positives must use the web
  form and not email. That FAQ page now returns 404, so I couldn't confirm it.

**Unusual:** the dedicated form seems to be gone. Use the contact form and email the text
below as a backup.

**Subject:** `False Positive URL on VirusTotal: synqiq.co`

**Text:**

> False positive URL on VirusTotal: https://synqiq.co/ and https://www.synqiq.co/ are flagged as phishing. SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX (Next.js on Vercel, Supabase authentication). It collects no payment information, does not imitate any other brand, and does not ask for credentials to other services. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site has a public landing page, privacy policy, terms, and security.txt. Requested category: Business / Software-as-a-Service. Contact: adam@thepreservehouston.com

---

## 11. SOCRadar

**Link:** email `vt@socradar.io` (**VT-listed** only). SOCRadar's own site has no public
false-positive process that I could find.

**Email subject:** `VirusTotal false positive: synqiq.co`

**Email body:**

> Hello SOCRadar team,
>
> Your engine flags https://synqiq.co/ and https://www.synqiq.co/ as phishing on VirusTotal. This is a false positive.
>
> SynqIQ is a staff scheduling and substitute-coverage tool used by a fitness facility in Houston, TX. It is built with Next.js, hosted on Vercel, and uses Supabase authentication. The site collects no payment information, does not imitate any other brand, and does not ask for credentials to any other service. "SynqIQ" is the product's brand name, not an algorithmically generated domain. The site has a public landing page, privacy policy, terms, and security.txt.
>
> Requested category: Business / Software-as-a-Service.
>
> Thank you,
> [your name]
> adam@thepreservehouston.com

---

## DNS: DMARC record to add (Cloudflare)

Checked 2026-10-14 against 1.1.1.1 and 8.8.8.8:

| Record | Status |
|---|---|
| `_dmarc.synqiq.co` TXT | Added 2026-10-14: `v=DMARC1; p=none; rua=mailto:<id>@dmarc-reports.cloudflare.net,mailto:info@synqiq.co` (Cloudflare DMARC Management plus info@) |
| `synqiq.co` SPF | Present: `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| `resend._domainkey.synqiq.co` DKIM | Present (RSA public key) |
| `send.synqiq.co` SPF (Resend return path) | Present: `v=spf1 include:amazonses.com ~all` |

Add in Cloudflare under **DNS > Records > Add record**:

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:info@synqiq.co` |
| TTL | Auto |

---

## Tracking

| Vendor | Date submitted | Ticket # | Status |
|---|---|---|---|
| Fortinet (malicious-URL appeal) | 2026-10-14 | | Submitted |
| Fortinet (category rating) | 2026-10-14 | | Submitted |
| Forcepoint | 2026-10-14 | | Emailed reviewmysite@forcepoint.com from info@synqiq.co |
| Webroot / BrightCloud: synqiq.co | 2026-10-14 | | Submitted |
| Webroot / BrightCloud: www.synqiq.co | 2026-10-14 | | Submitted |
| Sophos | 2026-10-14 | | Emailed samples@sophos.com from info@synqiq.co |
| Bitdefender | 2026-10-14 | 1011605486 | CLEARED 2026-10-15: no longer classified as a threat |
| ESET | 2026-10-14 | 6acfb513031f | Auto-reply received; awaiting verdict (follow up after 3 days) |
| G Data | 2026-10-14 | CAS-2641238-P2Z5F7 | Replied 2026-10-15: URL not blocked by G DATA software (already wasn't at submission) |
| VIPRE | 2026-10-14 | | Helpdesk false-positive form submitted; email verified |
| alphaMountain.ai | 2026-10-14 | 139078 | CLEARED 2026-10-14: rescanned and reclassified; partners update within 24h |
| Lionic | 2026-10-14 | | Submitted via contact form (confirmation shown) |
| SOCRadar | 2026-10-14 | 183702 | CLEARED 2026-10-14: added to allowlist, ticket solved |
| DMARC record added | 2026-10-14 | n/a | Done, verified on 1.1.1.1 and 8.8.8.8 |
| VirusTotal reanalyze | | n/a | |
