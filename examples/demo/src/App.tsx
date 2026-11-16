import { getVisitor, signOut } from 'gatecrypt/client';
import { Suspense, lazy, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { Home } from './pages/Home';
import { Account } from './pages/Account';
import { Team } from './pages/Team';

// Code-split: this chunk is fetched (and decrypted) only when the route is visited.
const Reports = lazy(() => import('./pages/Reports'));

export function App() {
  // Who signed in. For display only: see the package README.
  const [email, setEmail] = useState<string>();
  useEffect(() => {
    void getVisitor().then((visitor) => setEmail(visitor?.email));
  }, []);

  return (
    <>
      <header>
        <strong>Acme handbook</strong>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/team">Team</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/reports/q3">Q3 report</NavLink>
          <NavLink to="/account">Account</NavLink>
        </nav>
        {email && <span data-testid="visitor">{email}</span>}
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main>
        <Suspense fallback={<p>Loading…</p>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/team" element={<Team />} />
            <Route path="/account" element={<Account />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:id" element={<Reports />} />
            <Route path="*" element={<h1>No such page</h1>} />
          </Routes>
        </Suspense>
      </main>
    </>
  );
}
