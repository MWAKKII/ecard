"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

interface EventSummary {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  startsAt?: string | null;
  quotedAmount?: number | string;
  payments?: { status?: string }[];
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await fetch("/api/events");
        if (!res.ok) {
          throw new Error("Failed to fetch events");
        }
        const data = await res.json();
        setEvents(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 font-medium animate-pulse">Loading events...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-red-500 font-medium">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Your Events</h1>
          <Link
            href="/events/create"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium shadow hover:bg-blue-700 transition"
          >
            + Create New Event
          </Link>
        </div>

        {events.length === 0 ? (
          <div className="bg-white border rounded-xl p-12 text-center shadow-sm">
            <h3 className="text-lg font-medium text-gray-700">No events found</h3>
            <p className="text-gray-400 text-sm mt-1 mb-6">Get started by creating your first event.</p>
            <Link
              href="/events/create"
              className="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg font-medium hover:bg-blue-100 transition"
            >
              Create Event
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {events.map((event) => {
              const paymentStatus = event.payments?.[0]?.status || "PENDING";
              const displayStatus = event.status || "DRAFT";

              return (
                <div key={event.id} className="p-6 border rounded-xl shadow-sm bg-white flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-4">
                      <h3 className="font-bold text-xl text-gray-900">{event.title}</h3>
                      
                      {/* Payment & Event Status Badge */}
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full uppercase tracking-wider ${
                        displayStatus === "AUTHORIZED" 
                          ? "bg-green-100 text-green-800" 
                          : "bg-amber-100 text-amber-800"
                      }`}>
                        {displayStatus}
                      </span>
                    </div>

                    <p className="text-gray-500 text-sm mt-2">
                      {event.startsAt ? new Date(event.startsAt).toLocaleDateString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      }) : "No date set"}
                    </p>

                    {event.description && (
                      <p className="text-gray-600 text-sm mt-3 line-clamp-2">{event.description}</p>
                    )}
                  </div>

                  <div className="mt-6 pt-4 border-t border-gray-100 flex justify-between items-center text-sm text-gray-500">
                    <span>Payment: {paymentStatus} | Quote: {Number(event.quotedAmount || 0).toLocaleString()} TSh</span>
                    <div className="flex items-center gap-4">
                      {displayStatus === "AUTHORIZED" && (
                        <Link
                          href={`/events/${event.id}/guests`}
                          className="text-emerald-600 font-medium hover:underline"
                        >
                          Guests
                        </Link>
                      )}
                      <Link
                        href={`/events/${event.id}/pay`}
                        className="text-blue-600 font-medium hover:underline"
                      >
                        View Details &rarr;
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}