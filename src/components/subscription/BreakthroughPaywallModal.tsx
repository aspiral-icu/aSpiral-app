import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Check, X, Shield, ArrowRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  SUBSCRIPTION_PLANS,
  type SubscriptionInterval,
  initiateCheckout,
} from "@/lib/subscription";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface BreakthroughPaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: () => void;
  onContinueTextOnly: () => void;
}

export const BreakthroughPaywallModal: React.FC<BreakthroughPaywallModalProps> = ({
  isOpen,
  onClose,
  onUpgradeSuccess,
  onContinueTextOnly,
}) => {
  const { user, profile, updateProfile } = useAuth();
  const [interval, setInterval] = useState<SubscriptionInterval>("year");
  const [isUpgrading, setIsUpgrading] = useState(false);

  if (!isOpen) return null;

  const currentPlan = SUBSCRIPTION_PLANS[interval];

  const handleUpgrade = async () => {
    setIsUpgrading(true);
    try {
      const result = await initiateCheckout(interval, user?.id);

      if (result.demoUpgraded) {
        // Apply instant upgrade in profile state
        await updateProfile({ tier: "pro" });
        toast.success("Welcome to aSpiral Pro! Cinematic Visuals unlocked.");
        onUpgradeSuccess();
      } else if (result.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      console.error("Upgrade error:", err);
      toast.error("Could not complete checkout. Please try again.");
    } finally {
      setIsUpgrading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 sm:p-6">
        {/* Backdrop with enhanced blur */}
        <motion.div
          className="fixed inset-0 bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        />

        {/* Modal Container */}
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Unlock Cinematic 3D Breakthrough"
          className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-primary/40 bg-background/95 p-6 sm:p-8 shadow-2xl backdrop-blur-xl"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
        >
          {/* Aurora Ambient Glow Background */}
          <div
            className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full bg-gradient-to-br from-primary/30 via-emerald-500/20 to-transparent blur-3xl"
            aria-hidden="true"
          />

          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Header Section */}
          <div className="relative z-10 flex flex-col items-center text-center">
            <Badge
              variant="outline"
              className="mb-3 border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 backdrop-blur-sm"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              PREMIUM VISUAL ENGINE
            </Badge>

            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground font-display">
              Unlock the Cinematic 3D Breakthrough
            </h2>

            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Your thoughts have converged into clarity. Experience your breakthrough
              through full-screen WebGL 3D particle physics and dynamic camera travel.
            </p>
          </div>

          {/* Interval Toggle */}
          <div className="relative z-10 mt-6 flex justify-center">
            <div className="flex rounded-full border border-border/60 bg-muted/40 p-1 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setInterval("month")}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                  interval === "month"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Monthly (${SUBSCRIPTION_PLANS.month.priceFormatted})
              </button>
              <button
                type="button"
                onClick={() => setInterval("year")}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                  interval === "year"
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span>Annual (${SUBSCRIPTION_PLANS.year.priceFormatted})</span>
                <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300 font-bold">
                  Save 35%
                </span>
              </button>
            </div>
          </div>

          {/* Pricing Highlight Card */}
          <div className="relative z-10 mt-5 rounded-xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm">
            <div className="flex items-baseline justify-between border-b border-border/40 pb-3">
              <div>
                <span className="text-2xl font-extrabold text-foreground font-display">
                  {currentPlan.priceFormatted}
                </span>
                <span className="ml-1 text-xs text-muted-foreground">
                  / {currentPlan.interval === "month" ? "month" : "year"}
                </span>
              </div>
              <div className="text-right">
                <span className="text-xs font-medium text-emerald-400">
                  {currentPlan.priceMonthlyEquivalent}
                </span>
              </div>
            </div>

            {/* Feature List */}
            <ul className="mt-3 space-y-2 text-left">
              {currentPlan.features.map((feature, idx) => (
                <li key={idx} className="flex items-start text-xs text-foreground/90">
                  <Check className="mr-2 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="relative z-10 mt-6 flex flex-col gap-2.5">
            <Button
              size="lg"
              onClick={handleUpgrade}
              disabled={isUpgrading}
              className="w-full bg-gradient-to-r from-primary via-emerald-600 to-primary/90 text-white font-semibold shadow-lg shadow-emerald-500/20 hover:opacity-95 transition-opacity"
            >
              {isUpgrading ? (
                "Activating Pro..."
              ) : (
                <>
                  <span>Unlock Cinematic Experience</span>
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={onContinueTextOnly}
              className="text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40"
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              <span>Continue with Basic Text Summary (Free)</span>
            </Button>
          </div>

          {/* Guarantee / Security footnote */}
          <div className="relative z-10 mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <Shield className="h-3 w-3 text-emerald-400" />
            <span>Cancel anytime. Free core loop remains available indefinitely.</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
