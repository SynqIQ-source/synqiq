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
