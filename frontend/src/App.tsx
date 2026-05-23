import { useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";

import { SyntheticDataBanner } from "./components/SyntheticDataBanner";
import { Chat, type Message } from "./pages/Chat";
import { Traces } from "./pages/Traces";

export function App() {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<Message[]>([]);

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col">
        <SyntheticDataBanner />
        <Nav />
        <main className="flex-1">
          <Routes>
            <Route
              path="/"
              element={
                <Chat
                  selectedMemberId={selectedMemberId}
                  setSelectedMemberId={setSelectedMemberId}
                  chatMessages={chatMessages}
                  setChatMessages={setChatMessages}
                />
              }
            />
            <Route path="/traces" element={<Traces />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  );
}

function Nav() {
  return (
    <header className="bg-white border-b border-zinc-200">
      <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
        <div className="font-semibold text-zinc-900">Claims Inquiry Agent</div>
        <div className="flex gap-4 text-sm">
          <NavItem to="/">Chat</NavItem>
          <NavItem to="/traces">Traces</NavItem>
        </div>
      </nav>
    </header>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        isActive
          ? "text-indigo-700 font-medium border-b-2 border-indigo-600 pb-3 -mb-3"
          : "text-zinc-600 hover:text-zinc-900"
      }
    >
      {children}
    </NavLink>
  );
}

function NotFound() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12 text-center text-zinc-500">
      Page not found.
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-12 py-6 text-center text-xs text-zinc-500">
      <div className="mb-1">
        claims-agent · synthetic data only · not for production use
      </div>
      <div className="flex justify-center gap-1">
        <FooterLink href="https://github.com/rangbull-labs/claims-agent">
          GitHub
        </FooterLink>
        <span>·</span>
        <FooterLink href="https://github.com/rangbull-labs/claims-agent/blob/main/docs/DESIGN_DECISIONS.md">
          Design decisions
        </FooterLink>
        <span>·</span>
        <FooterLink href="https://github.com/rangbull-labs/claims-agent/blob/main/docs/LESSONS_LEARNED.md">
          Lessons learned
        </FooterLink>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:underline"
    >
      {children}
    </a>
  );
}
