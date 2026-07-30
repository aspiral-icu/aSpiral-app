import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { normalizeError, type NormalizedError } from '@/lib/normalizeError';
import {
  ArrowLeft,
  BarChart3,
  Users,
  Sparkles,
  MessageSquare,
  TrendingUp,
  Calendar,
  Loader2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { format, subDays, startOfDay } from 'date-fns';

interface DailyStats {
  date: string;
  sessions: number;
  breakthroughs: number;
  entities: number;
}

interface UsageStats {
  totalSessions: number;
  totalBreakthroughs: number;
  totalEntities: number;
  totalMessages: number;
  activeUsers: number;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--secondary))', 'hsl(var(--accent))', 'hsl(var(--muted))'];

// Performance Optimization: Cache the base daily stats template to avoid redundant
// date calculations (startOfDay, subDays, format) which are expensive when
// processed repeatedly.
let memoizedLast7Days: { date: string; dateObj: Date; sessions: number; breakthroughs: number; entities: number; }[] | null = null;
let lastUpdateDate: number | null = null;

const getDailyStatsTemplate = () => {
  const now = startOfDay(new Date()).getTime();

  if (memoizedLast7Days && lastUpdateDate === now) {
    // Return fresh object copies because the template is mutated during stat aggregation
    return memoizedLast7Days.map(d => ({ ...d }));
  }

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = startOfDay(subDays(new Date(), 6 - i));
    return {
      date: format(date, 'MMM d'),
      dateObj: date,
      sessions: 0,
      breakthroughs: 0,
      entities: 0,
    };
  });

  memoizedLast7Days = last7Days;
  lastUpdateDate = now;
  return last7Days.map(d => ({ ...d }));
};

/**
 * Default stats for first-run / empty states.
 * These are NOT errors - zero is a valid state.
 */
const EMPTY_USAGE_STATS: UsageStats = {
  totalSessions: 0,
  totalBreakthroughs: 0,
  totalEntities: 0,
  totalMessages: 0,
  activeUsers: 1,
};

const AdminDashboard = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [error, setError] = useState<NormalizedError | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats>(EMPTY_USAGE_STATS);
  const [entityTypes, setEntityTypes] = useState<{ name: string; value: number }[]>([]);

  const loadStats = useCallback(async (isRetry = false) => {
    if (isRetry) {
      setIsRetrying(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      type DatabaseRow = { id: string; created_at: string; user_id?: string; session_id?: string; type?: string };
      // Cast supabase to any to bypass strict typing for tables not yet in schema
      const db = supabase as unknown as {
        from: (table: string) => {
          select: (columns: string) => {
            eq: (column: string, value: string) => Promise<{ data: DatabaseRow[] | null; error: Error | null }>;
            in: (column: string, values: string[]) => Promise<{ data: DatabaseRow[] | null; error: Error | null }>;
            then: (resolve: (value: { data: DatabaseRow[] | null; error: Error | null }) => void) => Promise<{ data: DatabaseRow[] | null; error: Error | null }>;
          };
        };
      };

      // Get sessions
      const { data: sessions, error: sessionsError } = await db
        .from('sessions')
        .select('id, created_at, user_id')
        .eq('user_id', user!.id);

      // Handle sessions error - but empty is OK
      if (sessionsError) {
        const normalized = normalizeError(sessionsError);
        // Empty is success, not error
        if (normalized.kind !== 'empty') {
          throw sessionsError;
        }
      }

      // Performance Optimization: Replaced chained .map() and Array.from() with a single-pass loop
      const sessionIds = new Set<string>();
      const sessionIdsArray: string[] = [];
      if (sessions) {
        for (let i = 0; i < sessions.length; i++) {
          const id = sessions[i].id;
          if (!sessionIds.has(id)) {
            sessionIds.add(id);
            sessionIdsArray.push(id);
          }
        }
      }

      // If no sessions, skip sub-queries as there will be no user-specific data
      if (sessionIdsArray.length === 0) {
        setUsageStats({
          totalSessions: 0,
          totalBreakthroughs: 0,
          totalEntities: 0,
          totalMessages: 0,
          activeUsers: 1,
        });
        setEntityTypes([]);
        setDailyStats([]);
        setIsLoading(false);
        setIsRetrying(false);
        return;
      }

      // Get other stats - use Promise.allSettled for partial rendering
      const [breakthroughsRes, entitiesRes] = await Promise.allSettled([
        db.from('breakthroughs').select('id, created_at, session_id').in('session_id', sessionIdsArray),
        db.from('session_entities').select('id, type, created_at, session_id').in('session_id', sessionIdsArray),
      ]);

      // Extract data, treating errors as empty arrays (partial rendering)
      const userBreakthroughs = breakthroughsRes.status === 'fulfilled'
        ? breakthroughsRes.value.data || []
        : [];
      const userEntities = entitiesRes.status === 'fulfilled'
        ? entitiesRes.value.data || []
        : [];
      const userMessages: DatabaseRow[] = [];

      // Calculate usage stats - zeros are valid for first-run
      setUsageStats({
        totalSessions: sessions?.length || 0,
        totalBreakthroughs: userBreakthroughs.length,
        totalEntities: userEntities.length,
        totalMessages: userMessages.length,
        activeUsers: 1, // Current user's dashboard
      });

      // Calculate entity types
      const typeCounts: Record<string, number> = {};
      userEntities.forEach((e) => {
        const entityType = e.type || 'unknown';
        typeCounts[entityType] = (typeCounts[entityType] || 0) + 1;
      });
      setEntityTypes(Object.entries(typeCounts).map(([name, value]) => ({ name, value })));

      // Calculate daily stats for last 7 days - zeros are fine
      const last7Days = getDailyStatsTemplate();

      // Use a Map for O(1) lookup while maintaining local timezone correctness
      const dayMap = new Map<number, (typeof last7Days)[0]>();
      last7Days.forEach((d) => {
        dayMap.set(d.dateObj.getTime(), d);
      });

      (sessions || []).forEach((s) => {
        const sessionDate = startOfDay(new Date(s.created_at));
        const dayEntry = dayMap.get(sessionDate.getTime());
        if (dayEntry) dayEntry.sessions++;
      });

      userBreakthroughs.forEach((b) => {
        const bDate = startOfDay(new Date(b.created_at));
        const dayEntry = dayMap.get(bDate.getTime());
        if (dayEntry) dayEntry.breakthroughs++;
      });

      userEntities.forEach((e) => {
        const eDate = startOfDay(new Date(e.created_at));
        const dayEntry = dayMap.get(eDate.getTime());
        if (dayEntry) dayEntry.entities++;
      });

      setDailyStats(last7Days.map(({ date, sessions, breakthroughs, entities }) => ({
        date,
        sessions,
        breakthroughs,
        entities,
      })));

      // Clear any previous error
      setError(null);

      // Check if any partial failures occurred (non-blocking warning)
      const partialFailures = [breakthroughsRes, entitiesRes]
        .filter(r => r.status === 'rejected');

      if (partialFailures.length > 0 && partialFailures.length < 2) {
        // Some data loaded, some failed - show non-blocking warning
        console.warn('Dashboard partial load failures:', partialFailures);
        toast({
          title: 'Some data may be incomplete',
          description: 'Retry to refresh all stats',
          variant: 'default', // Not destructive - non-blocking
        });
      }

    } catch (err) {
      console.error('Error loading stats:', err);
      const normalized = normalizeError(err);

      // Only show error for real failures, not empty data
      if (!normalized.isNonError) {
        setError(normalized);
        toast({
          title: 'Error loading dashboard',
          description: normalized.message,
          variant: 'destructive',
        });
      }
      // Even on error, keep default zeros displayed
    } finally {
      setIsLoading(false);
      setIsRetrying(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) {
      loadStats();
    }
  }, [user, loadStats]);

  const handleRetry = () => {
    loadStats(true);
  };

  const StatCard = ({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; color: string }) => (
    <div className="glass-card p-6">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl ${color} flex items-center justify-center`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="app-container min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="app-container min-h-screen">
      <div className="ambient-orb w-96 h-96 bg-primary/30 top-0 left-0" />
      <div className="ambient-orb w-80 h-80 bg-secondary/20 bottom-20 right-10" style={{ animationDelay: '-5s' }} />

      <div className="relative z-10 container max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/app')}
            className="rounded-xl"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="font-display text-2xl font-bold text-foreground">
              Dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Your usage analytics and insights
            </p>
          </div>
          {/* Retry button - always visible for manual refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={isRetrying}
            className="rounded-xl"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Error Banner - Only for real errors, not empty states */}
        {error && !error.isNonError && (
          <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-center gap-4">
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-destructive">Error loading dashboard</p>
              <p className="text-sm text-destructive/80">{error.message}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={isRetrying}
              className="border-destructive/30 text-destructive hover:bg-destructive/10"
            >
              {isRetrying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Retry'
              )}
            </Button>
          </div>
        )}

        {/* Stats Grid - Always render, zeros are valid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={Calendar}
            label="Sessions"
            value={usageStats.totalSessions}
            color="bg-primary/20 text-primary"
          />
          <StatCard
            icon={Sparkles}
            label="Breakthroughs"
            value={usageStats.totalBreakthroughs}
            color="bg-accent/20 text-accent"
          />
          <StatCard
            icon={TrendingUp}
            label="Entities"
            value={usageStats.totalEntities}
            color="bg-secondary/20 text-secondary"
          />
          <StatCard
            icon={MessageSquare}
            label="Messages"
            value={usageStats.totalMessages}
            color="bg-muted text-muted-foreground"
          />
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Activity Chart */}
          <div className="glass-card p-6">
            <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Activity (Last 7 Days)
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={dailyStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="sessions"
                  stackId="1"
                  stroke="hsl(var(--primary))"
                  fill="hsl(var(--primary) / 0.3)"
                  name="Sessions"
                />
                <Area
                  type="monotone"
                  dataKey="breakthroughs"
                  stackId="1"
                  stroke="hsl(var(--accent))"
                  fill="hsl(var(--accent) / 0.3)"
                  name="Breakthroughs"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Entity Types */}
          <div className="glass-card p-6">
            <h3 className="font-medium text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Entity Types
            </h3>
            {entityTypes.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={entityTypes}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {entityTypes.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                No entity data yet
              </div>
            )}
            {entityTypes.length > 0 && (
              <div className="flex flex-wrap gap-3 mt-4 justify-center">
                {entityTypes.map((type, index) => (
                  <div key={type.name} className="flex items-center gap-2 text-sm">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="text-muted-foreground">{type.name}: {type.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
