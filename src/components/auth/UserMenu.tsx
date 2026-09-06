import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogIn, LogOut, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isProTier } from '@/lib/subscription';
import { BreakthroughPaywallModal } from '@/components/subscription/BreakthroughPaywallModal';

export const UserMenu = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [isPaywallOpen, setIsPaywallOpen] = useState(false);

  const handleSignOut = async () => {
    try {
      const { signOut: appSignOut } = await import('@/lib/auth');
      await signOut();
      await appSignOut();
      navigate('/');
    } catch (error) {
      console.error('Sign out error:', error);
    }
  };

  if (!user) {
    return (
      <Button
        variant="outline"
        size="default"
        onClick={() => navigate('/auth')}
        className="border-primary/50 text-primary bg-primary/5 hover:bg-primary/15 hover:border-primary font-medium px-4 py-2 min-w-[100px]"
      >
        <LogIn className="mr-2 h-4 w-4" />
        Sign In
      </Button>
    );
  }

  const isPro = isProTier(profile?.tier);

  return (
    <div className="flex items-center gap-2">
      {isPro ? (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-semibold px-2.5 py-1 text-xs tracking-wider"
        >
          <Sparkles className="mr-1 h-3 w-3" />
          PRO
        </Badge>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsPaywallOpen(true)}
          className="border-emerald-500/50 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 font-medium text-xs px-3 py-1.5"
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Upgrade
        </Button>
      )}

      <Button
        variant="outline"
        size="default"
        onClick={handleSignOut}
        className="border-destructive/50 text-destructive bg-destructive/5 hover:bg-destructive/15 hover:border-destructive font-medium px-4 py-2 min-w-[100px]"
      >
        <LogOut className="mr-2 h-4 w-4" />
        Sign Out
      </Button>

      {/* Subscription Paywall Modal */}
      <BreakthroughPaywallModal
        isOpen={isPaywallOpen}
        onClose={() => setIsPaywallOpen(false)}
        onUpgradeSuccess={() => setIsPaywallOpen(false)}
        onContinueTextOnly={() => setIsPaywallOpen(false)}
      />
    </div>
  );
};
