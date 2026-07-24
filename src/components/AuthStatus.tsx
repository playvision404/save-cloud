"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AuthStatus() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    async function getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setEmail(user?.email ?? null);
    }

    getUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    setEmail(null);
  }

  return (
    <div className="mt-5">
      {email ? (
        <>
          <p>Eingeloggt als: {email}</p>

          <button
            className="bg-red-600 text-white p-2 mt-3"
            onClick={logout}
          >
            Logout
          </button>
        </>
      ) : (
        <p>Nicht eingeloggt</p>
      )}
    </div>
  );
}