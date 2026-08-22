 
import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { UserTier } from '@/lib/entityLimits';

import type { Database } from '@/integrations/supabase/types';
import { normalizeAuthError } from '@/lib/normalizeError';
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface Profile {
  id: string;
  display_name: ProfileRow['display_name'];
  avatar_url: ProfileRow['avatar_url'];
  tier: UserTier;
  created_at: ProfileRow['created_at'];
  updated_at: ProfileRow['updated_at'];
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Synchronously detect dev mock user so ProtectedRoute never sees loading=true with no user
function getDevMockUser(): { user: User; session: Session } | null {
  if (typeof window === 'undefined') return null;
  if (!localStorage.getItem('dev_mock_user')) return null;
  const mock = { id: 'mock-user-123', email: 'user@aspiral.icu', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() } as User;
  return { user: mock, session: { user: mock, access_token: 'mock', token_type: 'bearer', expires_in: 3600, refresh_token: 'mock' } as Session };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const devMock = getDevMockUser();
  const [user, setUser] = useState<User | null>(devMock?.user ?? null);
  const [session, setSession] = useState<Session | null>(devMock?.session ?? null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(!devMock);

  // Fetch user profile - uses any type since profiles table may not exist yet
  const fetchProfile = async (userId: string): Promise<Profile | null> => {
    try {
      // Using 'as any' because the profiles table might not be in the generated types yet
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        // Profile table might not exist yet - this is expected
        console.warn('Profile fetch skipped:', error.message);
        return null;
      }
      return data as Profile;
    } catch (err) {
      console.warn('Profile fetch error:', err);
      return null;
    }
  };

  useEffect(() => {
    // Check for dev mock user (local preview and automated visual audits)
    if (typeof window !== 'undefined' && localStorage.getItem('dev_mock_user')) {
      const mock = { id: 'mock-user-123', email: 'user@aspiral.icu', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: new Date().toISOString() } as User;
      setUser(mock);
      setSession({ user: mock, access_token: 'mock', token_type: 'bearer', expires_in: 3600, refresh_token: 'mock' } as Session);
      setLoading(false);
      return;
    }

    // DEFENSIVE: Handle case where onAuthStateChange returns malformed data
    let subscription: { unsubscribe: () => void } | undefined;

    try {
      const authListener = supabase.auth.onAuthStateChange(
        (event, session) => {
          setSession(session);
          setUser(session?.user ?? null);

          // Defer profile fetch with setTimeout to avoid deadlock
          if (session?.user) {
            setTimeout(() => {
              fetchProfile(session.user.id).then(setProfile);
            }, 0);
          } else {
            setProfile(null);
          }
        }
      );

      // Safely extract subscription - prevents "Cannot read properties of undefined"
      subscription = authListener?.data?.subscription;

      if (!subscription) {
        console.error('[AuthContext] onAuthStateChange did not return a valid subscription');
      }
    } catch (error) {
      console.error('[AuthContext] Failed to set up auth listener:', error);
    }

    // THEN check for existing session
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          fetchProfile(session.user.id).then(setProfile);
        }
        setLoading(false);
      })
      .catch((error) => {
        console.error('[AuthContext] Failed to get session:', error);
        setLoading(false);
      });

    return () => {
      subscription?.unsubscribe?.();
    };
  }, []);

  const signUp = async (email: string, password: string, displayName?: string) => {
    try {
      // FIX: HashRouter requires hash-based redirect URL (/#/app not /app).
      // Without the hash, post-email-verification redirect lands on Landing page.
      const redirectUrl = typeof globalThis !== 'undefined' && 'window' in globalThis ? `${globalThis.window.location.origin}/#/app` : '/#/app';

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            display_name: displayName || email.split('@')[0],
          },
        },
      });

      if (error) return { error };
      return { error: null };
    } catch (err) {
      return { error: normalizeAuthError(err) };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) return { error };
      return { error: null };
    } catch (err) {
      return { error: normalizeAuthError(err) };
    }
  };

  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          // FIX: HashRouter requires hash-based redirect URL (/#/app not /app).
          redirectTo: typeof globalThis !== 'undefined' && 'window' in globalThis ? `${globalThis.window.location.origin}/#/app` : '/#/app',
        },
      });

      if (error) return { error };
      return { error: null };
    } catch (err) {
      return { error: normalizeAuthError(err) };
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return { error: new Error('No user logged in') };

    try {
      // Using 'as any' because the profiles table might not be in the generated types yet
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

      if (error) return { error };

      // Refresh profile
      const newProfile = await fetchProfile(user.id);
      setProfile(newProfile);

      return { error: null };
    } catch (err) {
      return { error: normalizeAuthError(err) };
    }
  };

  const value = {
    user,
    session,
    profile,
    loading,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
