"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/ToastProvider";

import AuthStatus from "@/components/AuthStatus";
import SaveManager from "@/components/SaveManager";

export default function Home() {
  const { showToast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);

  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);

  useEffect(() => {
    let ignore = false;

    supabase.auth.getUser().then(({ data }) => {
      if (!ignore) {
        setUser(data.user);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
      }
    });

    return () => {
      ignore = true;
      subscription.unsubscribe();
    };
  }, []);


  async function register() {

    const {
      error
    } = await supabase.auth.signUp({
      email,
      password,
    });


    if (error) {
      showToast(error.message);
    } else {
      showToast("Registrierung erfolgreich!", "success");
    }

  }



  async function login() {

    const {
      error
    } = await supabase.auth.signInWithPassword({
      email,
      password,
    });


    if (error) {
      showToast(error.message);
    } else {
      showToast("Login erfolgreich!", "success");
    }

  }

  async function requestPasswordReset() {
    if (!email) {
      showToast("Bitte zuerst E-Mail-Adresse eingeben.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
    });

    if (error) {
      showToast(error.message);
    } else {
      showToast(
        "Falls diese E-Mail-Adresse registriert ist, wurde ein Link zum Zurücksetzen verschickt.",
        "success"
      );
    }
  }

  async function submitNewPassword() {
    if (newPassword.length < 6) {
      showToast("Passwort muss mindestens 6 Zeichen lang sein.");
      return;
    }

    setSettingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });

      if (error) {
        showToast(error.message);
        return;
      }

      showToast("Neues Passwort gesetzt.", "success");
      setRecoveryMode(false);
      setNewPassword("");
    } finally {
      setSettingPassword(false);
    }
  }



  if (recoveryMode) {
    return (
      <main className="min-h-screen p-10">
        <h1 className="text-4xl font-bold mb-6">Neues Passwort setzen</h1>

        <div className="max-w-md">
          <input
            className="border rounded p-2 w-full mb-3"
            placeholder="Neues Passwort"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />

          <button
            className="bg-blue-600 text-white rounded p-2 disabled:opacity-50"
            disabled={settingPassword}
            onClick={submitNewPassword}
          >
            {settingPassword ? "Speichert..." : "Passwort speichern"}
          </button>
        </div>
      </main>
    );
  }

  return (

    <main className="min-h-screen p-10">

      <h1 className="text-4xl font-bold mb-6">
        Emulator Save Cloud
      </h1>



      <div className="max-w-md">

        <input
          className="border rounded p-2 w-full mb-3"
          placeholder="E-Mail"
          type="email"
          value={email}
          onChange={(e)=>
            setEmail(e.target.value)
          }
        />



        <input
          className="border rounded p-2 w-full mb-3"
          placeholder="Passwort"
          type="password"
          value={password}
          onChange={(e)=>
            setPassword(e.target.value)
          }
        />



        <button
          className="bg-black text-white rounded p-2 mr-3"
          onClick={register}
        >
          Registrieren
        </button>



        <button
          className="bg-blue-600 text-white rounded p-2"
          onClick={login}
        >
          Anmelden
        </button>

        <div className="mt-2">
          <button
            className="text-sm text-gray-500 underline"
            onClick={requestPasswordReset}
          >
            Passwort vergessen?
          </button>
        </div>



        <AuthStatus />


      </div>



      {user ? (
        <SaveManager />
      ) : (
        <p className="mt-10 text-gray-600">
          Bitte melde dich an, um deine Save-Cloud zu sehen.
        </p>
      )}


    </main>

  );

}
