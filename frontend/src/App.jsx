import { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell, NavLink, Group, Title, Loader, Center, Badge, Text, Divider,
  Alert, ActionIcon, Stack, Burger, useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconDashboard, IconPlug, IconUsers, IconCategory, IconList, IconLogout,
  IconShield, IconKey, IconRobot, IconBuilding,
  IconRouteSquare, IconServerBolt,
  IconMap2, IconExternalLink, IconX, IconMessageChatbot, IconSettings, IconBrain, IconTerminal2,
} from '@tabler/icons-react';
import ModelPrismLogo from './components/ModelPrismLogo';
import DemoBanner from './components/DemoBanner';
import DemoOverlay from './components/DemoOverlay';
import api from './hooks/useApi';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Providers from './pages/Providers';
import Tenants from './pages/Tenants';
import Categories from './pages/Categories';
import RequestLog from './pages/RequestLog';
import Users from './pages/Users';
import LdapSettings from './pages/LdapSettings';
import Models from './pages/Models';
import MyTenant from './pages/MyTenant';
import Docs from './pages/Docs';
import RoutingConfig from './pages/RoutingConfig';
import IdeSetup from './pages/IdeSetup';
import SystemDashboard from './pages/SystemDashboard';
import Settings from './pages/Settings';
import Chat from './pages/Chat';
import PromptEngineerPros from './pages/PromptEngineerPros';
import GuidedTour, { TOUR_STEPS } from './components/GuidedTour';

const DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

const ROLE_COLOR = {
  admin: 'red',
  maintainer: 'orange',
  finops: 'teal',
  'tenant-viewer': 'blue',
  'tenant-admin': 'cyan',
};

// ── Main app shell ─────────────────────────────────────────────────────────────
function AppContent() {
  const [loading, setLoading]         = useState(DEMO ? false : true);
  const [setupComplete, setSetupComplete] = useState(DEMO ? true : false);
  const [authenticated, setAuthenticated] = useState(DEMO ? true : false);
  const [currentUser, setCurrentUser] = useState(
    DEMO ? { id: 'demo', username: 'demo-admin', role: 'admin' } : null
  ); // { id, username, role }
  const [showTour, setShowTour]       = useState(false);
  const [tourInitialStep, setTourInitialStep] = useState(0);
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure();
  const [chatEnabled, setChatEnabled] = useState(false);
  const [analysesEnabled, setAnalysesEnabled] = useState(false);
  const [featuresLoaded, setFeaturesLoaded] = useState(false);
  const [appearance, setAppearance] = useState(() => {
    try { return JSON.parse(localStorage.getItem('prism_appearance')) || { theme: 'dark', brandName: '', pageTitle: '', custom: {} }; }
    catch { return { theme: 'dark', brandName: '', pageTitle: '', custom: {} }; }
  });

  // Apply theme from appearance settings
  // Apply theme color scheme
  const { setColorScheme } = useMantineColorScheme();
  useEffect(() => {
    const t = appearance.theme;
    if (t === 'light') setColorScheme('light');
    else if (t === 'system' || t === 'auto') setColorScheme('auto');
    else if (t === 'custom' && appearance.custom?.bodyBg) {
      // Auto-detect: light bg → Mantine light scheme, dark bg → Mantine dark scheme
      const hex = appearance.custom.bodyBg;
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      setColorScheme(lum > 0.5 ? 'light' : 'dark');
    } else {
      setColorScheme('dark');
    }
  }, [appearance.theme, appearance.custom?.bodyBg]);

  // Apply branding to document title
  useEffect(() => {
    if (appearance.brandName) {
      const title = appearance.pageTitle
        ? appearance.pageTitle.replace('{brand}', appearance.brandName)
        : `${appearance.brandName} — Open Model Prism`;
      document.title = title;
    }
  }, [appearance.brandName, appearance.pageTitle]);

  // Apply custom theme CSS variables — maps ALL appearance.custom fields to CSS vars
  useEffect(() => {
    const root = document.documentElement;
    if (appearance.theme === 'custom' && appearance.custom) {
      const c = appearance.custom;

      // 1. Prism custom properties (our own)
      const prismMap = {
        bodyBg: '--prism-bg-body', navBg: '--prism-bg-sidebar', headerBg: '--prism-bg-header',
        cardBg: '--prism-bg-card', inputBg: '--prism-bg-input', hoverBg: '--prism-bg-hover',
        codeBg: '--prism-bg-code', textColor: '--prism-text', textDimmed: '--prism-text-dimmed',
        textMuted: '--prism-text-muted', borderColor: '--prism-border',
        primaryColor: '--prism-primary', accentColor: '--prism-accent',
        successColor: '--prism-success', warningColor: '--prism-warning',
        errorColor: '--prism-error', infoColor: '--prism-info',
        chartGrid: '--prism-chart-grid', tooltipBg: '--prism-tooltip-bg',
        navText: '--prism-nav-text', navActive: '--prism-nav-active',
        navHoverBg: '--prism-nav-hover-bg', btnText: '--prism-btn-text',
        scrollbar: '--prism-scrollbar',
      };
      for (const [key, cssVar] of Object.entries(prismMap)) {
        if (c[key]) root.style.setProperty(cssVar, c[key]);
      }
      // Derived vars
      if (c.borderColor) {
        root.style.setProperty('--prism-border-light', c.borderColor);
        root.style.setProperty('--prism-border-medium', c.borderColor);
        root.style.setProperty('--prism-border-lighter', c.borderColor);
        root.style.setProperty('--prism-border-blockquote', c.borderColor);
        root.style.setProperty('--prism-tooltip-border', c.borderColor);
      }
      if (c.scrollbar) root.style.setProperty('--prism-scrollbar-hover', c.scrollbar);

      // 2. Mantine core layout variables
      if (c.bodyBg) root.style.setProperty('--mantine-color-body', c.bodyBg);
      if (c.textColor) root.style.setProperty('--mantine-color-text', c.textColor);
      if (c.textDimmed) root.style.setProperty('--mantine-color-dimmed', c.textDimmed);
      if (c.borderColor) root.style.setProperty('--mantine-color-default-border', c.borderColor);
      if (c.cardBg) root.style.setProperty('--mantine-color-default', c.cardBg);
      if (c.hoverBg) root.style.setProperty('--mantine-color-default-hover', c.hoverBg);
      if (c.textMuted) root.style.setProperty('--mantine-color-placeholder', c.textMuted);
      if (c.errorColor) root.style.setProperty('--mantine-color-error', c.errorColor);

      // 3. Primary color (Mantine uses indigo as primaryColor — override ALL indigo shades)
      if (c.primaryColor) {
        for (let i = 0; i <= 9; i++) root.style.setProperty(`--mantine-color-indigo-${i}`, c.primaryColor);
        root.style.setProperty('--mantine-color-indigo-filled', c.primaryColor);
        root.style.setProperty('--mantine-color-indigo-filled-hover', c.primaryColor);
        root.style.setProperty('--mantine-color-indigo-light', c.hoverBg || c.inputBg || c.primaryColor + '20');
        root.style.setProperty('--mantine-color-indigo-light-color', c.primaryColor);
        root.style.setProperty('--mantine-color-indigo-light-hover', c.hoverBg || c.inputBg || c.primaryColor + '30');
      }

      // 4. Anchor/link color
      if (c.primaryColor) root.style.setProperty('--mantine-color-anchor', c.primaryColor);

      // 5. Mantine dark-* scale (used by many components for bg/border/hover)
      if (c.textDimmed)  root.style.setProperty('--mantine-color-dark-0', c.textDimmed);
      if (c.textDimmed)  root.style.setProperty('--mantine-color-dark-1', c.textDimmed);
      if (c.textMuted)   root.style.setProperty('--mantine-color-dark-2', c.textMuted);
      if (c.borderColor) root.style.setProperty('--mantine-color-dark-3', c.borderColor);
      if (c.borderColor) root.style.setProperty('--mantine-color-dark-4', c.borderColor);
      if (c.borderColor) root.style.setProperty('--mantine-color-dark-5', c.borderColor);
      if (c.hoverBg)     root.style.setProperty('--mantine-color-dark-6', c.hoverBg);
      if (c.cardBg)      root.style.setProperty('--mantine-color-dark-7', c.cardBg);
      if (c.inputBg)     root.style.setProperty('--mantine-color-dark-8', c.inputBg);
      if (c.bodyBg)      root.style.setProperty('--mantine-color-dark-9', c.bodyBg);
      if (c.primaryColor) root.style.setProperty('--mantine-color-dark-filled', c.primaryColor);

      // 6. Gray scale (used by subtle buttons, disabled states)
      if (c.borderColor) {
        root.style.setProperty('--mantine-color-gray-3', c.borderColor);
        root.style.setProperty('--mantine-color-gray-4', c.borderColor);
      }
      if (c.hoverBg) {
        root.style.setProperty('--mantine-color-gray-0', c.bodyBg || c.cardBg);
        root.style.setProperty('--mantine-color-gray-1', c.hoverBg);
        root.style.setProperty('--mantine-color-gray-light', c.hoverBg);
      }
      if (c.textDimmed) {
        root.style.setProperty('--mantine-color-gray-6', c.textDimmed);
        root.style.setProperty('--mantine-color-gray-7', c.textColor || c.textDimmed);
      }

      // 6b. Auto-detect light vs dark custom theme from bodyBg luminance
      // and apply appropriate badge/light-variant colors
      const hexToLuminance = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return 0.299 * r + 0.587 * g + 0.114 * b;
      };
      const isLightBg = c.bodyBg ? hexToLuminance(c.bodyBg) > 0.5 : false;

      if (isLightBg) {
        root.setAttribute('data-mantine-color-scheme', 'light');
        // Light theme: make filled badges vibrant (Mantine defaults are too muted)
        const filledMap = {
          green: c.successColor || '#25cc78', red: c.errorColor || '#e03131',
          orange: c.warningColor || '#ff6c12', yellow: '#f59f00', blue: c.primaryColor || '#228be6',
          teal: '#0c8599', violet: '#7048e8', cyan: '#1098ad', indigo: c.primaryColor || '#4263eb',
          pink: '#d6336c', grape: '#ae3ec9', lime: '#74b816',
        };
        for (const [color, val] of Object.entries(filledMap)) {
          root.style.setProperty(`--mantine-color-${color}-filled`, val);
          root.style.setProperty(`--mantine-color-${color}-filled-hover`, val);
          // Light-variant: use the success/error/warning colors as text, not the pastel defaults
          root.style.setProperty(`--mantine-color-${color}-light-color`, val);
        }
      } else {
        root.setAttribute('data-mantine-color-scheme', 'dark');
      }

      // 7. Input + NavLink component-level vars
      if (c.inputBg)     root.style.setProperty('--input-bg', c.inputBg);
      if (c.borderColor) root.style.setProperty('--input-bd', c.borderColor);
      if (c.primaryColor) root.style.setProperty('--input-bd-focus', c.primaryColor);
      if (c.textColor)   root.style.setProperty('--input-color', c.textColor);
      if (c.textMuted)   root.style.setProperty('--input-placeholder-color', c.textMuted);
      if (c.navHoverBg)  root.style.setProperty('--nl-hover', c.navHoverBg);
      if (c.cardBg)      root.style.setProperty('--code-bg', c.codeBg || c.inputBg);

      // 8. Button text color override
      if (c.btnText) root.style.setProperty('--button-color', c.btnText);

      // 9. NavLink active color (if different from primary)
      if (c.navActive && c.navActive !== c.primaryColor) {
        // Override indigo light variants for NavLink active state
        root.style.setProperty('--mantine-color-indigo-light-color', c.navActive);
      }

      // 9. AppShell border
      if (c.borderColor) root.style.setProperty('--app-shell-border-color', c.borderColor);

    } else {
      // Reset ALL custom vars when switching away from custom
      const allVars = [
        '--mantine-color-body', '--mantine-color-text', '--mantine-color-dimmed',
        '--mantine-color-default-border', '--mantine-color-default', '--mantine-color-default-hover',
        '--mantine-color-placeholder', '--mantine-color-error', '--mantine-color-anchor',
        '--mantine-color-dark-filled', '--app-shell-border-color',
        '--input-bg', '--input-bd', '--input-bd-focus', '--input-color', '--input-placeholder-color',
        '--nl-hover', '--code-bg', '--button-color',
      ];
      // Reset dark-0 through dark-9
      for (let i = 0; i <= 9; i++) allVars.push(`--mantine-color-dark-${i}`);
      // Reset all light-variant color overrides
      const bc = ['blue','violet','teal','green','orange','pink','cyan','indigo','lime','grape','red','yellow'];
      for (const c of bc) { allVars.push(`--mantine-color-${c}-light`); allVars.push(`--mantine-color-${c}-light-color`); }
      // Reset indigo shades
      for (let i = 0; i <= 9; i++) allVars.push(`--mantine-color-indigo-${i}`);
      ['filled', 'filled-hover', 'light', 'light-color', 'light-hover'].forEach(s => allVars.push(`--mantine-color-indigo-${s}`));
      // Reset gray shades
      [0, 1, 3, 4, 6, 7].forEach(i => allVars.push(`--mantine-color-gray-${i}`));
      allVars.push('--mantine-color-gray-light');
      const style = document.querySelector('style');
      if (style) {
        const matches = style.textContent.matchAll(/--prism-[\w-]+/g);
        for (const m of matches) allVars.push(m[0]);
      }
      [...new Set(allVars)].forEach(v => root.style.removeProperty(v));
    }
  }, [appearance.theme, appearance.custom]);

  function startTour() {
    // Start at the step matching the current page, fall back to 0 (Welcome)
    const idx = TOUR_STEPS.findIndex(s => s.to === location.pathname);
    setTourInitialStep(idx >= 0 ? idx : 0);
    setShowTour(true);
  }
  const navigate  = useNavigate();
  const location  = useLocation();

  useEffect(() => {
    if (DEMO) {
      loadFeatureStates();
    } else {
      checkSetup();
    }
  }, []);

  // After setup completes → navigate to /models and open the guided tour
  useEffect(() => {
    if (authenticated && localStorage.getItem('prism_tour_pending')) {
      localStorage.removeItem('prism_tour_pending');
      navigate('/models');
      setShowTour(true);
    }
  }, [authenticated]);

  async function checkSetup() {
    try {
      const { data } = await api.get('/api/prism/setup/status');
      setSetupComplete(data.setupComplete);
      if (data.setupComplete) {
        const token = localStorage.getItem('token');
        if (token) {
          try {
            const { data: me } = await api.get('/api/prism/auth/me');
            setCurrentUser(me);
            setAuthenticated(true);
            loadFeatureStates();
          } catch {
            localStorage.removeItem('token');
          }
        }
      }
    } catch (err) {
      console.error('Setup check failed:', err);
    }
    setLoading(false);
  }

  async function loadFeatureStates() {
    try {
      const [chatRes, analysesRes, appearanceRes] = await Promise.all([
        api.get('/api/prism/admin/chat/config').catch(() => ({ data: {} })),
        api.get('/api/prism/admin/prompt-engineer/settings').catch(() => ({ data: {} })),
        api.get('/api/prism/admin/appearance').catch(() => ({ data: {} })),
      ]);
      setChatEnabled(chatRes.data?.enabled ?? false);
      setAnalysesEnabled(analysesRes.data?.enabled ?? false);
      if (appearanceRes.data?.theme) setAppearance(appearanceRes.data);
    } catch {}
    setFeaturesLoaded(true);
  }

  function handleLogin(userData) {
    setCurrentUser(userData);
    setAuthenticated(true);
    loadFeatureStates();
    navigate('/');
  }

  function handleLogout() {
    localStorage.removeItem('token');
    setCurrentUser(null);
    setAuthenticated(false);
    navigate('/login');
  }

  if (loading) return (
    <Center h="100vh" style={{ background: 'var(--prism-bg-body)', flexDirection: 'column', gap: 16 }}>
      <ModelPrismLogo height={64} />
      <Loader size="md" color="blue" type="dots" />
    </Center>
  );
  // Public routes — accessible without login
  if (location.pathname === '/public/config') return <IdeSetup isPublic />;
  if (location.pathname === '/public/chat') return <Chat isPublic brandName={appearance.brandName} chatTitle={appearance.chatTitle} logoSrc={appearance.logoData || appearance.logoUrl} />;
  if (location.pathname === '/public-chat') { window.location.replace('/public/chat'); return null; } // legacy redirect
  // After setup: set tour flag, re-run checkSetup (token already in localStorage) → lands on /models
  if (!setupComplete) return <Setup onComplete={() => { localStorage.setItem('prism_tour_pending', '1'); checkSetup(); }} />;
  if (!authenticated) return <Login onLogin={handleLogin} />;

  const role          = currentUser?.role || 'chat-user';
  const isAdmin       = role === 'admin';
  const isMaint       = role === 'admin' || role === 'maintainer';
  const canView       = ['admin', 'maintainer', 'finops', 'auditor'].includes(role);
  const isTenantAdmin = role === 'tenant-admin';
  const isTenantMaint = role === 'tenant-maintainer';
  const isChatOnly    = role === 'chat-user';
  const isAuditor     = role === 'auditor';
  const hasDashboard  = !isChatOnly && !['tenant-admin', 'tenant-viewer'].includes(role);
  const hasTenantView = ['tenant-maintainer', 'tenant-admin', 'tenant-viewer'].includes(role);
  const canViewLogs   = canView || hasTenantView;

  // Chat-only users see only the Chat page
  if (isChatOnly) {
    return (
      <>
        <Chat isAdmin={false} />
      </>
    );
  }

  const navSections = [
    {
      items: [
        { icon: IconDashboard,      label: 'Dashboard',       to: '/',        show: hasDashboard },
        { icon: IconMessageChatbot, label: 'Chat',            to: '/chat',    show: chatEnabled },
        { icon: IconPlug,           label: 'Providers',       to: '/providers', show: isMaint },
        { icon: IconRobot,          label: 'Models',          to: '/models',  show: isMaint },
        { icon: IconUsers,          label: 'Tenants',         to: '/tenants', show: isMaint || canView },
        { icon: IconCategory,       label: 'Categories',      to: '/categories',    show: isMaint || canView },
        { icon: IconRouteSquare,    label: 'Routing Config',  to: '/routing-config', show: isMaint || canView },
        { icon: IconServerBolt,     label: 'System',          to: '/system',   show: isMaint || isAuditor },
        { icon: IconList,           label: 'Request Log',     to: '/requests', show: canViewLogs },
        { icon: IconBrain,          label: 'Prompt Analyses', to: '/prompt-analyzer', show: analysesEnabled && (isMaint || isAdmin) },
      ],
    },
    {
      label: 'My Account',
      show: isTenantAdmin || isTenantMaint || hasTenantView,
      items: [
        { icon: IconBuilding, label: 'My Tenant', to: '/my-tenant', show: isTenantAdmin || isTenantMaint || hasTenantView },
      ],
    },
    {
      label: 'Admin',
      show: isAdmin,
      items: [
        { icon: IconShield,   label: 'Users',         to: '/users',     show: isAdmin },
        { icon: IconSettings, label: 'Settings',      to: '/settings',  show: isAdmin },
      ],
    },
    {
      label: 'Help',
      items: [
        { icon: IconTerminal2, label: 'IDE Setup', to: '/ide-setup', show: true },
        { icon: IconMap2,  label: 'Start Tour',     to: null,   show: true, onClick: startTour },
      ],
    },
  ];

  return (
    <>
    {DEMO && <DemoBanner />}
    {DEMO && <DemoOverlay />}
    <div style={DEMO ? { paddingTop: 30 } : undefined}>
    <AppShell
      header={{ height: { base: 54, sm: 0 } }}
      navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      footer={{ height: 0 }}
      padding="md"
    >
      <AppShell.Navbar p="md" style={{ display: 'flex', flexDirection: 'column', background: 'var(--prism-bg-sidebar)', color: 'var(--prism-nav-text)', ...(DEMO ? { zIndex: 1001 } : {}) }}>
        <Group mb="md" gap="xs" align="center">
          {(appearance.logoData || appearance.logoUrl) ? (
            <img src={appearance.logoData || appearance.logoUrl} alt="Logo" style={{ height: 28, width: 'auto' }} />
          ) : (
            <ModelPrismLogo height={28} />
          )}
          <div>
            <Title order={5} lh={1.2}>{appearance.brandName ? `${appearance.brandName}` : 'Open Model Prism'}</Title>
            <Badge size="xs" variant="light" style={{ marginTop: 1 }}>v{APP_VERSION}</Badge>
          </div>
        </Group>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {navSections.map((section, si) =>
            section.show === false ? null : (
              <div key={si}>
                {section.label && (
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase" px={4} mt="sm" mb={4}>
                    {section.label}
                  </Text>
                )}
                {section.items.filter(i => i.show).map(item => (
                  item.external ? (
                    <NavLink
                      key={item.href}
                      label={<Group gap={4}>{item.label}<IconExternalLink size={12} opacity={0.5} /></Group>}
                      leftSection={<item.icon size={18} />}
                      component="a"
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      mb={2}
                    />
                  ) : (
                    <NavLink
                      key={item.to ?? item.label}
                      label={item.label}
                      leftSection={<item.icon size={18} />}
                      active={item.to ? location.pathname === item.to : false}
                      onClick={item.onClick ? () => { item.onClick(); closeNav(); } : () => { navigate(item.to); closeNav(); }}
                      mb={2}
                    />
                  )
                ))}
                {section.label && <Divider my="xs" />}
              </div>
            )
          )}
        </div>

        <div>
          <Divider mb="xs" />
          <Group px={4} mb={6} justify="space-between">
            <div>
              <Text size="sm" fw={500}>{currentUser?.username}</Text>
              <Badge size="xs" color={ROLE_COLOR[role]} variant="light">{role}</Badge>
            </div>
          </Group>
          <NavLink
            label="Logout"
            leftSection={<IconLogout size={18} />}
            onClick={() => { handleLogout(); closeNav(); }}
            color="red"
          />
        </div>
      </AppShell.Navbar>

      <AppShell.Header hiddenFrom="sm" style={DEMO ? { top: 30 } : undefined}>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={navOpened} onClick={toggleNav} size="sm" />
            <ModelPrismLogo height={24} />
            <Title order={5} lh={1.2}>Model Prism</Title>
          </Group>
          <Group gap="xs">
            <Text size="sm" fw={500}>{currentUser?.username}</Text>
            <Badge size="xs" color={ROLE_COLOR[role]} variant="light">{role}</Badge>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main style={{ position: 'relative' }}>
        {!featuresLoaded && authenticated && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 100,
            background: 'var(--prism-bg-overlay)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Loader size="lg" color="blue" type="dots" />
          </div>
        )}
        <Routes>
          <Route path="/"           element={isTenantAdmin || hasTenantView ? <Navigate to="/my-tenant" /> : <Dashboard />} />
          <Route path="/chat"       element={<Chat isAdmin={isMaint} />} />
          <Route path="/providers"  element={isMaint  ? <Providers /> : <Navigate to="/" />} />
          <Route path="/models"     element={isMaint  ? <Models />    : <Navigate to="/" />} />
          <Route path="/tenants"    element={isMaint || canView ? <Tenants readOnly={!isMaint} />  : <Navigate to="/" />} />
          <Route path="/categories" element={isMaint || canView ? <Categories /> : <Navigate to="/" />} />
          <Route path="/requests"   element={canViewLogs ? <RequestLog isAdmin={isAdmin} /> : <Navigate to="/" />} />
          <Route path="/failed"     element={canView  ? <RequestLog filterFailed isAdmin={isAdmin} /> : <Navigate to="/" />} />
          <Route path="/users"      element={isAdmin  ? <Users currentUser={currentUser} /> : <Navigate to="/" />} />
          <Route path="/ldap"       element={isAdmin  ? <LdapSettings /> : <Navigate to="/" />} />
          <Route path="/routing-config" element={isMaint || canView ? <RoutingConfig readOnly={!isMaint} /> : <Navigate to="/" />} />
          <Route path="/system"        element={isMaint || isAuditor ? <SystemDashboard currentUser={currentUser} /> : <Navigate to="/" />} />
          <Route path="/settings"     element={isAdmin ? <Settings currentUser={currentUser} onSettingsChanged={loadFeatureStates} /> : <Navigate to="/" />} />
          <Route path="/my-tenant"  element={isTenantAdmin || isTenantMaint || hasTenantView || isMaint ? <MyTenant /> : <Navigate to="/" />} />
          <Route path="/docs"       element={<Docs />} />
          <Route path="/prompt-analyzer" element={(isMaint || isAdmin) ? <PromptEngineerPros isAdmin={isAdmin} /> : <Navigate to="/" />} />
          <Route path="/ide-setup"  element={<IdeSetup />} />
          <Route path="*"           element={<Navigate to="/" />} />
        </Routes>
      </AppShell.Main>

      <GuidedTour opened={showTour} onClose={() => setShowTour(false)} initialStep={tourInitialStep} />
    </AppShell>
    </div>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
