import { describe, expect, it } from "vitest";
import { mfaState, sessionCounts } from "@/lib/auth/mfa-policy";

describe("two-step sign-in policy", () => {
  it("anyone with an authenticator must enter a code first", () => {
    for (const role of ["admin", "sales_lead", "sales", "staff"]) {
      const state = mfaState({ role, currentLevel: "aal1", nextLevel: "aal2" });
      expect(state).toBe("needs_code");
      expect(sessionCounts(state)).toBe(false);
    }
  });

  it("a session that entered its code is fully signed in", () => {
    const state = mfaState({ role: "admin", currentLevel: "aal2", nextLevel: "aal2" });
    expect(state).toBe("ok");
    expect(sessionCounts(state)).toBe(true);
  });

  it("Club Admins without an authenticator are asked to set one up", () => {
    expect(mfaState({ role: "admin", currentLevel: "aal1", nextLevel: "aal1" })).toBe("setup_recommended");
    expect(mfaState({ role: "admin", currentLevel: "aal1", nextLevel: "aal1", requireForClubAdmins: true })).toBe(
      "setup_required",
    );
    expect(sessionCounts("setup_recommended")).toBe(true);
  });

  it("other roles without an authenticator are not prompted", () => {
    for (const role of ["sales_lead", "sales", "staff"]) {
      expect(mfaState({ role, currentLevel: "aal1", nextLevel: "aal1" })).toBe("ok");
    }
  });

  it("missing assurance data is treated as not enrolled", () => {
    expect(mfaState({ role: "staff", currentLevel: null, nextLevel: null })).toBe("ok");
    expect(mfaState({ role: "admin", currentLevel: undefined, nextLevel: undefined })).toBe("setup_recommended");
  });
});
