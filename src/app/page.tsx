"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

import AuthStatus from "@/components/AuthStatus";
import SaveManager from "@/components/SaveManager";

export default function Home() {

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");


  async function register() {

    const {
      error
    } = await supabase.auth.signUp({
      email,
      password,
    });


    if (error) {
      alert(error.message);
    } else {
      alert(
        "Registrierung erfolgreich!"
      );
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
      alert(error.message);
    } else {
      alert(
        "Login erfolgreich!"
      );
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



      <SaveManager />


    </main>

  );

}