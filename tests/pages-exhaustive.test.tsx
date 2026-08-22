// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import Auth from '../src/pages/Auth';
import ApiKeys from '../src/pages/ApiKeys';
import Breakthroughs from '../src/pages/Breakthroughs';
import Sessions from '../src/pages/Sessions';
import AdminDashboard from '../src/pages/AdminDashboard';
import VoiceYourChaos from '../src/pages/steps/VoiceYourChaos';
import AnswerQuestions from '../src/pages/steps/AnswerQuestions';

// Mock matchMedia
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock AuthContext
vi.mock('../src/contexts/AuthContext', () => ({
  useAuth: vi.fn().mockReturnValue({
    session: { user: { id: 'test-user', email: 'test@example.com' } },
    user: { id: 'test-user', email: 'test@example.com' },
    signOut: vi.fn(),
    isAdmin: true,
  }),
  AuthProvider: ({ children }: any) => <>{children}</>
}));

// Mock Supabase
vi.mock('../src/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: {}, error: null }),
    })
  }
}));

// Mock Three.js/Fiber to prevent WebGL context errors in jsdom
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: any) => <div data-testid="mock-canvas">{children}</div>,
  useFrame: vi.fn(),
  useThree: vi.fn().mockReturnValue({ viewport: { width: 10, height: 10 } }),
}));

vi.mock('@react-three/drei', () => ({
  Float: ({ children }: any) => <div data-testid="mock-float">{children}</div>,
  Text: ({ children }: any) => <div data-testid="mock-text">{children}</div>,
  OrbitControls: () => <div data-testid="mock-orbit-controls" />,
  Environment: () => <div data-testid="mock-environment" />,
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

import { afterAll, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(() => {
  cleanup();
});

afterAll(() => {
  queryClient.clear();
});

const renderWithRouter = (ui: React.ReactElement) => {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>
        <BrowserRouter>{ui}</BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

describe('Exhaustive Pages Render Tests', () => {
  it('renders Auth page', () => {
    const { container } = renderWithRouter(<Auth />);
    expect(container).toBeTruthy();
  });

  it('renders ApiKeys page', () => {
    const { container } = renderWithRouter(<ApiKeys />);
    expect(container).toBeTruthy();
  });

  it('renders Breakthroughs page', () => {
    const { container } = renderWithRouter(<Breakthroughs />);
    expect(container).toBeTruthy();
  });

  it('renders Sessions page', () => {
    const { container } = renderWithRouter(<Sessions />);
    expect(container).toBeTruthy();
  });

  it('renders AdminDashboard page', () => {
    const { container } = renderWithRouter(<AdminDashboard />);
    expect(container).toBeTruthy();
  });

  it('renders VoiceYourChaos page', () => {
    const { container } = renderWithRouter(<VoiceYourChaos />);
    expect(container).toBeTruthy();
  });

  it('renders AnswerQuestions page', () => {
    const { container } = renderWithRouter(<AnswerQuestions />);
    expect(container).toBeTruthy();
  });
});
