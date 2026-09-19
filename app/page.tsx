"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export default function Home() {
  const [status, setStatus] = useState("Connecting to database...");

  useEffect(() => {
    async function testConnection() {
      const { error } = await supabase
        .from("parlays")
        .select("*")
        .limit(1);

      if (error) {
        console.error(error);
        setStatus("❌ Database connection failed");
      } else {
        setStatus("✅ Supabase connected successfully");
      }
    }

    testConnection();
  }, []);

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold">
        Responsible Degenerate Gambling
      </h1>

      <p className="mt-4 text-zinc-400">
        {status}
      </p>
    </main>
  );
}
