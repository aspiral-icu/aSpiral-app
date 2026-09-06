import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isProTier,
  SUBSCRIPTION_PLANS,
  initiateCheckout,
} from "../subscription";

describe("Subscription & Monetization Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isProTier", () => {
    it("returns true for valid pro tiers", () => {
      expect(isProTier("pro")).toBe(true);
      expect(isProTier("creator")).toBe(true);
      expect(isProTier("business")).toBe(true);
      expect(isProTier("enterprise")).toBe(true);
      expect(isProTier("PRO")).toBe(true);
      expect(isProTier("Enterprise")).toBe(true);
    });

    it("returns false for free tier or falsy values", () => {
      expect(isProTier("free")).toBe(false);
      expect(isProTier("FREE")).toBe(false);
      expect(isProTier(null)).toBe(false);
      expect(isProTier(undefined)).toBe(false);
      expect(isProTier("")).toBe(false);
    });
  });

  describe("SUBSCRIPTION_PLANS", () => {
    it("defines monthly plan matching omnifinance market comps ($8.99/mo)", () => {
      const plan = SUBSCRIPTION_PLANS.month;
      expect(plan.id).toBe("aspiral-pro-monthly");
      expect(plan.priceFormatted).toBe("$8.99");
      expect(plan.priceCents).toBe(899);
      expect(plan.features.length).toBeGreaterThanOrEqual(3);
    });

    it("defines annual plan with 35% discount ($69.99/yr)", () => {
      const plan = SUBSCRIPTION_PLANS.year;
      expect(plan.id).toBe("aspiral-pro-annual");
      expect(plan.priceFormatted).toBe("$69.99");
      expect(plan.priceCents).toBe(6999);
      expect(plan.savingsBadge).toContain("35%");
      expect(plan.features.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("initiateCheckout", () => {
    it("provides sandbox demo upgrade when live Stripe keys are unconfigured", async () => {
      const result = await initiateCheckout("month", "test-user-id");
      expect(result).toBeDefined();
      expect(result.demoUpgraded).toBe(true);
    });
  });
});
