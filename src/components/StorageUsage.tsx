"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Usage = {
  usedBytes: number;
  maxBytes: number;
};

function formatMb(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export default function StorageUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function run() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!ignore) setLoading(false);
        return;
      }

      // Belegter Speicher = aktive Saves + Papierkorb + gesamter Verlauf,
      // da all das tatsächlich im Storage-Bucket liegt.
      const [savesResult, versionsResult, subscriptionResult] = await Promise.all([
        supabase.from("saves").select("file_size").eq("user_id", user.id),
        supabase.from("save_versions").select("file_size").eq("user_id", user.id),
        supabase.from("subscriptions").select("max_storage_bytes").eq("user_id", user.id).maybeSingle(),
      ]);

      const usedBytes =
        (savesResult.data ?? []).reduce((sum, row) => sum + (row.file_size ?? 0), 0) +
        (versionsResult.data ?? []).reduce((sum, row) => sum + (row.file_size ?? 0), 0);

      // Fallback auf 200 MB, falls aus irgendeinem Grund keine
      // subscriptions-Zeile existiert (sollte durch DB-Trigger eigentlich
      // nicht vorkommen).
      const maxBytes = subscriptionResult.data?.max_storage_bytes ?? 200 * 1024 * 1024;

      if (!ignore) {
        setUsage({ usedBytes, maxBytes });
        setLoading(false);
      }
    }

    run();

    return () => {
      ignore = true;
    };
  }, []);

  if (loading || !usage) return null;

  const percent = Math.min(100, Math.round((usage.usedBytes / usage.maxBytes) * 100));
  const nearLimit = percent >= 90;

  return (
    <div className="mt-4">
      <div className="flex justify-between text-sm text-gray-600">
        <span>Speicherplatz</span>
        <span>
          {formatMb(usage.usedBytes)} MB von {formatMb(usage.maxBytes)} MB
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded h-2 mt-1">
        <div
          className={`h-2 rounded ${nearLimit ? "bg-red-600" : "bg-blue-600"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {nearLimit && (
        <p className="text-xs text-red-600 mt-1">
          Speicherplatz wird knapp — alte Versionen im Verlauf löschen oder
          Papierkorb leeren hilft.
        </p>
      )}
    </div>
  );
}
