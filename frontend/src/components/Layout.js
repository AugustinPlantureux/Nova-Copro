import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/auth';
import Logo from './Logo';
import {
  LayoutDashboard, Users, Building2, LogOut, FileSpreadsheet,
  Menu, X, ChevronRight, Settings, Shield,
} from 'lucide-react';

const NavLink = ({ href, icon: Icon, label, active }) => (
  <Link
    href={href}
    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-150 text-sm font-medium
      ${active
        ? 'bg-brand-600 text-white shadow-sm'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
  >
    <Icon size={18} />
    <span>{label}</span>
    {active && <ChevronRight size={14} className="ml-auto opacity-60" />}
  </Link>
);

export default function Layout({ children, title }) {
  const { user, logout, isAdmin } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Mes documents' },
    ...(isAdmin ? [
      { href: '/admin',              icon: Settings,       label: 'Tableau de bord admin' },
      { href: '/admin/coproprietes', icon: Building2,      label: 'Copropriétés' },
      { href: '/admin/users',        icon: Users,          label: 'Utilisateurs' },
      { href: '/admin/import',       icon: FileSpreadsheet,label: 'Import Excel' },
      { href: '/admin/audit',        icon: Shield,         label: 'Journal d\'audit' },
    ] : []),
  ];

  const initials = [user?.prenom?.[0], user?.nom?.[0]].filter(Boolean).join('').toUpperCase() || '?';

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      <div className="bg-gradient-to-br from-brand-900 to-brand-700 p-6">
        <Logo size="sm" />
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navLinks.map((link) => (
          <NavLink
            key={link.href}
            {...link}
            active={router.pathname === link.href}
          />
        ))}
      </nav>

      <div className="p-4 border-t border-gray-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-brand-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              {user?.prenom} {user?.nom}
            </p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut size={16} />
          <span>Se déconnecter</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="hidden lg:flex flex-col w-64 bg-white border-r border-gray-100 fixed inset-y-0 z-30 shadow-sm">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 bg-white shadow-2xl flex flex-col">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1 text-white/80 hover:text-white"
            >
              <X size={20} />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <header className="bg-white border-b border-gray-100 px-4 lg:px-8 py-4 flex items-center gap-4 sticky top-0 z-20 shadow-sm">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-600"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        </header>

        <main className="flex-1 p-4 lg:p-8">
          {children}
        </main>

        <footer className="py-4 px-8 text-center text-xs text-gray-400 border-t border-gray-100">
          Nova Copro © {new Date().getFullYear()} — Espace documentaire sécurisé
        </footer>
      </div>
    </div>
  );
}
