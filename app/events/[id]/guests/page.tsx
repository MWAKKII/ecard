"use client";

import { useParams } from "next/navigation";
import GuestManager from "@/components/guest-manager";

/**
 * Kept for backwards compatibility: the event workspace (/events/[id]) is the
 * main entry point now, but existing links to this URL keep working — both
 * render the same GuestManager (spec Step 8).
 */
export default function GuestsPage() {
  const params = useParams();
  const eventId = String(params.id);
  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <GuestManager eventId={eventId} />
      </div>
    </div>
  );
}
