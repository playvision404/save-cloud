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

  useEffect(() => {
    let ignore = false;

    supabase.auth.getUser().then(({ data }) => {
      if (!ignore) {
        setUser(data.user);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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