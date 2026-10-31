import { getEnv, getOptionalEnv } from "@/lib/env";
import type { MindbodyOccurrenceId } from "@/lib/mindbody/types";

type MindbodyClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  siteId?: string;
  username?: string;
  password?: string;
};

type MindbodyRequestOptions = {
  method?: "GET" | "POST";
  accessToken?: string;
  body?: unknown;
  searchParams?: Record<string, string | number | boolean | undefined>;
};

export class MindbodyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly siteId: string;
  private readonly username?: string;
  private readonly password?: string;

  constructor(options: MindbodyClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ??
      getOptionalEnv("MINDBODY_API_BASE_URL") ??
      "https://api.mindbodyonline.com/public/v6";
    this.apiKey = options.apiKey ?? getEnv("MINDBODY_API_KEY");
    this.siteId = options.siteId ?? getEnv("MINDBODY_SITE_ID");
    this.username = options.username ?? getOptionalEnv("MINDBODY_USERNAME");
    this.password = options.password ?? getOptionalEnv("MINDBODY_PASSWORD");
  }

  async authenticate() {
    if (!this.username || !this.password) {
      throw new Error("Mindbody username and password are required to authenticate.");
    }

    return this.request("/usertoken/issue", {
      method: "POST",
      body: {
        Username: this.username,
        Password: this.password,
      },
    });
  }

  // A user token for data Mindbody hides on a plain Api-Key + SiteId request
  // (class capacity and bookings, staff emails, appointments, clients,
  // visits). Throws a clear error instead of returning nothing: a sync that
  // carried on without a token would write Mindbody's masked zeros and
  // nulls over real data -- how every class's capacity was wiped in the
  // 2026-10-28 credentials test. The sync stops and records the error.
  async requireAccessToken(): Promise<string> {
    const who = this.username ? `"${this.username}"` : "(MINDBODY_USERNAME not set)";
    let auth: { AccessToken?: string } | undefined;
    try {
      auth = await this.authenticate();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Mindbody login failed for ${who}, so the sync stopped without changing any data. Check MINDBODY_USERNAME and MINDBODY_PASSWORD (no extra spaces or tabs). ${detail}`,
      );
    }
    if (!auth?.AccessToken) {
      throw new Error(`Mindbody login for ${who} returned no token, so the sync stopped without changing any data.`);
    }
    return auth.AccessToken;
  }

  async getClasses(
    accessToken?: string,
    filters?: {
      startDateTime?: string;
      endDateTime?: string;
      locationId?: number;
      offset?: number;
      limit?: number;
    },
  ) {
    return this.request("/class/classes", {
      method: "GET",
      accessToken,
      searchParams: {
        StartDateTime: filters?.startDateTime,
        EndDateTime: filters?.endDateTime,
        LocationIds: filters?.locationId,
        Offset: filters?.offset,
        Limit: filters?.limit,
      },
    });
  }

  async getStaff(accessToken?: string, pagination?: { offset?: number; limit?: number }) {
    return this.request("/staff/staff", {
      method: "GET",
      accessToken,
      searchParams: {
        Offset: pagination?.offset,
        Limit: pagination?.limit,
      },
    });
  }

  // The activation code and link a studio owner opens to approve Synq for
  // this client's site. Works for any real site, approved or not.
  async getActivationCode() {
    return this.request("/site/activationcode", { method: "GET" }) as Promise<{
      ActivationCode?: string;
      ActivationLink?: string;
    }>;
  }

  async getSite(accessToken?: string) {
    return this.request("/site/sites", {
      method: "GET",
      accessToken,
    });
  }

  async getLocations(accessToken?: string) {
    return this.request("/site/locations", {
      method: "GET",
      accessToken,
    });
  }

  async getResources(accessToken?: string) {
    return this.request("/site/resources", {
      method: "GET",
      accessToken,
    });
  }

  async getClassDescriptions(
    accessToken?: string,
    pagination?: { offset?: number; limit?: number },
  ) {
    return this.request("/class/classdescriptions", {
      method: "GET",
      accessToken,
      searchParams: {
        Offset: pagination?.offset,
        Limit: pagination?.limit,
      },
    });
  }

  async getStaffAppointments(
    accessToken?: string,
    filters?: {
      startDate?: string;
      endDate?: string;
      offset?: number;
      limit?: number;
    },
  ) {
    return this.request("/appointment/staffappointments", {
      method: "GET",
      accessToken,
      searchParams: {
        StartDate: filters?.startDate,
        EndDate: filters?.endDate,
        Offset: filters?.offset,
        Limit: filters?.limit,
      },
    });
  }

  async getSales(
    accessToken?: string,
    filters?: {
      startSaleDateTime?: string;
      endSaleDateTime?: string;
      offset?: number;
      limit?: number;
    },
  ) {
    return this.request("/sale/sales", {
      method: "GET",
      accessToken,
      searchParams: {
        StartSaleDateTime: filters?.startSaleDateTime,
        EndSaleDateTime: filters?.endSaleDateTime,
        Offset: filters?.offset,
        Limit: filters?.limit,
      },
    });
  }

  async getClients(accessToken?: string, pagination?: { offset?: number; limit?: number }) {
    return this.request("/client/clients", {
      method: "GET",
      accessToken,
      searchParams: {
        Offset: pagination?.offset,
        Limit: pagination?.limit,
      },
    });
  }

  // Mindbody's client search matches name, email and phone. SearchText is a
  // query parameter by Mindbody's design; this is a server-to-server call,
  // and the value never appears in SynqIQ's own URLs or logs.
  async searchClients(searchText: string, accessToken: string) {
    return this.request("/client/clients", {
      method: "GET",
      accessToken,
      searchParams: { SearchText: searchText, Limit: 25 },
    });
  }

  // A client's contracts (memberships), for the enrollment date of a member
  // who just turned Active. ClientId is Mindbody's client Id, not UniqueId.
  async getClientContracts(clientId: string, accessToken: string) {
    return this.request("/client/clientcontracts", {
      method: "GET",
      accessToken,
      searchParams: { ClientId: clientId, Limit: 50 },
    });
  }

  async getRequiredClientFields(accessToken: string) {
    return this.request("/client/requiredclientfields", { method: "GET", accessToken });
  }

  async addClient(client: Record<string, unknown>, accessToken: string) {
    return this.request("/client/addclient", { method: "POST", accessToken, body: client });
  }

  async getClassVisits(occurrenceId: MindbodyOccurrenceId, accessToken?: string) {
    return this.request("/class/classvisits", {
      method: "GET",
      accessToken,
      searchParams: {
        // MindBody's ClassID param is occurrence-scoped (matches Classes[].Id),
        // NOT ClassScheduleId -- confirmed empirically, passing the series id
        // silently resolves to a different (wrong) class with no error.
        ClassID: occurrenceId,
      },
    });
  }

  async substituteClassTeacher(
    occurrenceId: MindbodyOccurrenceId,
    staffId: number,
    accessToken?: string,
  ) {
    return this.request("/class/substituteclassteacher", {
      method: "POST",
      accessToken,
      body: {
        // Occurrence-level Id, same ClassId/ClassID-is-occurrence-scoped
        // rule as getClassVisits -- confirmed empirically (see conversation
        // history): passing the recurring series id instead silently
        // resolves to a different, unrelated class with no error.
        ClassId: occurrenceId,
        StaffId: staffId,
      },
    });
  }

  private async request(path: string, options: MindbodyRequestOptions = {}) {
    const url = new URL(`${this.baseUrl}${path}`);

    Object.entries(options.searchParams ?? {}).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    // Node's fetch has no default timeout -- a connection that stalls after
    // establishing (confirmed happening during the class-visits backfill:
    // one call hung indefinitely with zero progress for 5+ minutes,
    // outliving withRetry entirely since a promise that never settles never
    // gives retry logic a chance to run) would otherwise hang the calling
    // process forever instead of failing fast into a retry.
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": this.apiKey,
        SiteId: this.siteId,
        ...(options.accessToken ? { Authorization: options.accessToken } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      let detail = bodyText;
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed?.Error?.Message) {
          detail = parsed.Error.Message;
        }
      } catch {
        // Not JSON -- fall back to the raw body text.
      }
      throw new Error(
        `Mindbody request failed: ${response.status} ${response.statusText}${detail ? ` -- ${detail}` : ""}`,
      );
    }

    return response.json();
  }
}

export function createMindbodyClient(options?: MindbodyClientOptions) {
  return new MindbodyClient(options);
}
