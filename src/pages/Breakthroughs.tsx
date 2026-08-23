import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { AppPageLayout } from '@/components/layout/AppPageLayout';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sparkles,
  Loader2,
  Calendar as CalendarIcon,
  Search,
  Share2,
  Zap,
  Target,
  Lightbulb,
  X,
} from 'lucide-react';
import { format, startOfDay, endOfDay } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useStreak } from '@/hooks/useStreak';

import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

interface BreakthroughItem {
  id: string;
  friction: string;
  grease: string;
  insight: string;
  achieved_at: string;
  session_id: string;
  _achievedAtTime?: number;
  _searchString?: string;
}

const logger = createLogger('BreakthroughsPage');

const matchesSearch = (b: BreakthroughItem, queryLower: string) => {
  if (!queryLower) return true;
  if (b._searchString) return b._searchString.includes(queryLower);
  return (
    b.friction.toLowerCase().includes(queryLower) ||
    b.grease.toLowerCase().includes(queryLower) ||
    b.insight.toLowerCase().includes(queryLower)
  );
};

const matchesDateRange = (time?: number, startOfFromTime?: number, endOfToTime?: number) => {
  if (!startOfFromTime && !endOfToTime) return true;
  if (time === undefined) return true; // Fallback if time isn't pre-computed
  if (startOfFromTime && time < startOfFromTime) return false;
  if (endOfToTime && time > endOfToTime) return false;
  return true;
};

const Breakthroughs = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [breakthroughs, setBreakthroughs] = useState<BreakthroughItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [exportingId, setExportingId] = useState<string | null>(null);
  const { streakDays } = useStreak(user?.id);

  const loadBreakthroughs = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
       
      const db = supabase as any;
      const { data, error } = await db
        .from('breakthroughs')
        .select('id, friction, grease, insight, achieved_at, session_id')
        .eq('user_id', user.id)
        .order('achieved_at', { ascending: false });

      if (error) throw error;

       
      const enrichedData = (data || []).map((b: any) => ({
        ...b,
        _achievedAtTime: new Date(b.achieved_at).getTime(),
        _searchString: `${b.friction} ${b.grease} ${b.insight}`.toLowerCase()
      }));
      setBreakthroughs(enrichedData);
    } catch (err) {
      logger.warn('Failed to load breakthroughs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadBreakthroughs();
  }, [loadBreakthroughs]);

  const filtered = useMemo(() => {
    const queryLower = searchQuery.toLowerCase();
    const startOfFromTime = dateFrom ? startOfDay(dateFrom).getTime() : undefined;
    const endOfToTime = dateTo ? endOfDay(dateTo).getTime() : undefined;

    return breakthroughs.filter((b) => {
      return matchesSearch(b, queryLower) && matchesDateRange(b._achievedAtTime ?? new Date(b.achieved_at).getTime(), startOfFromTime, endOfToTime);
    });
  }, [breakthroughs, searchQuery, dateFrom, dateTo]);

  const handleShare = async (b: BreakthroughItem) => {
    setExportingId(b.id);
    try {
      const { exportBreakthroughCard } = await import('@/lib/pdfExport');
      await exportBreakthroughCard({
        friction: b.friction,
        grease: b.grease,
        insight: b.insight,
        achievedAt: new Date(b.achieved_at),
      });
      toast({ title: 'Card exported', description: 'Breakthrough card saved as image.' });
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' });
    } finally {
      setExportingId(null);
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const hasFilters = searchQuery || dateFrom || dateTo;

  return (
    <AppPageLayout
      title="Breakthrough Gallery"
      subtitle={`${breakthroughs.length} breakthrough${breakthroughs.length === 1 ? '' : 's'} achieved`}
      streakDays={streakDays}
      backTo="/sessions"
    >
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search breakthroughs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 rounded-xl bg-muted/50 border-border"
          />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("rounded-xl gap-2", dateFrom && "text-foreground")}>
              <CalendarIcon className="w-4 h-4" />
              {dateFrom ? format(dateFrom, 'MMM d') : 'From'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom}
              onSelect={setDateFrom}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("rounded-xl gap-2", dateTo && "text-foreground")}>
              <CalendarIcon className="w-4 h-4" />
              {dateTo ? format(dateTo, 'MMM d') : 'To'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo}
              onSelect={setDateTo}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="rounded-xl gap-1 text-muted-foreground">
            <X className="w-3.5 h-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Sparkles className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-medium text-foreground mb-2">
            {hasFilters ? 'No matching breakthroughs' : 'No breakthroughs yet'}
          </h2>
          <p className="text-muted-foreground mb-6">
            {hasFilters
              ? 'Try adjusting your filters to find what you\'re looking for.'
              : 'Start a session and work through your friction to achieve your first breakthrough.'}
          </p>
          {hasFilters ? (
            <Button variant="outline" onClick={clearFilters}>Clear Filters</Button>
          ) : (
            <Button onClick={() => navigate('/app')}>
              <Sparkles className="w-4 h-4 mr-2" />
              Start a Session
            </Button>
          )}
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-280px)]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((b) => (
              <div key={b.id} className="glass-card p-5 flex flex-col gap-3 hover:bg-glass-hover transition-colors">
                {/* Date */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(b.achieved_at), 'MMM d, yyyy')}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-accent bg-accent/20">
                    <Sparkles className="w-3 h-3" />
                    Breakthrough
                  </span>
                </div>

                {/* Friction */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Target className="w-3.5 h-3.5" />
                    Friction
                  </div>
                  <p className="text-sm text-foreground line-clamp-2">{b.friction}</p>
                </div>

                {/* Grease */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                    <Zap className="w-3.5 h-3.5" />
                    Grease
                  </div>
                  <p className="text-sm text-foreground line-clamp-2">{b.grease}</p>
                </div>

                {/* Insight */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
                    <Lightbulb className="w-3.5 h-3.5" />
                    Insight
                  </div>
                  <p className="text-sm text-foreground line-clamp-3">{b.insight}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-auto pt-2 border-t border-border/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-lg gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => handleShare(b)}
                    disabled={exportingId === b.id}
                  >
                    {exportingId === b.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Share2 className="w-3.5 h-3.5" />
                    )}
                    Share Card
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </AppPageLayout>
  );
};

export default Breakthroughs;
