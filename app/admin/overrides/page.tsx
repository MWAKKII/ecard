"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type Tab = "events" | "clients";
type Feedback = { type: "success" | "error"; text: string } | null;

interface ClientAccount {
  id: string;
  name: string;
  email: string;
  username: string | null;
  phone: string | null;
  role: "ADMIN" | "ORGANIZER" | "STAFF";
  authorizationStatus: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  createdAt: string;
  _count: { events: number };
}

interface EventSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  guestCount: number;
  createdAt: string;
  owner: { id: string; name: string; email: string };
  _count: { guests: number };
}

interface Overview {
  clients: ClientAccount[];
  events: EventSummary[];
}

interface Attendance {
  id: string;
  status: string;
  checkedInAt: string | null;
  notes: string | null;
  checkedInById: string | null;
  updatedAt: string;
}

interface AdminGuest {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  cardType: "STANDARD" | "PREMIUM";
  cardStatus: string;
  deliveryStatus: string;
  deliveredAt: string | null;
  plusOnes: number;
  createdAt: string;
  attendances: Attendance[];
}

interface EventDetail {
  id: string;
  title: string;
  type: string;
  coupleNames: string | null;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  status: string;
  guestCount: number;
  quotedAmount: number | string;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    name: string;
    email: string;
    username: string | null;
    phone: string | null;
    authorizationStatus: string;
  };
  pricingTier: { id: string; minGuests: number; maxGuests: number; price: number } | null;
  cardTemplate: { id: string; title: string; status: string } | null;
  payments: {
    id: string;
    status: string;
    amount: number | string;
    currency: string;
    createdAt: string;
    rejectionReason: string | null;
  }[];
  guests: AdminGuest[];
  availableTemplates: { id: string; title: string }[];
}

const FIELD_CLASS =
  "mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100";
const LABEL_CLASS = "block text-sm font-semibold text-gray-700";
const PRIMARY_BUTTON =
  "rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON =
  "rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_BUTTON =
  "rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";

function eventStatusClass(status: string): string {
  if (status === "AUTHORIZED") return "bg-emerald-100 text-emerald-700";
  if (status === "SUSPENDED" || status === "CANCELLED") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

function attendanceStatusClass(status: string): string {
  if (status === "CHECKED_IN") return "bg-emerald-100 text-emerald-700";
  if (status === "NO_SHOW") return "bg-red-100 text-red-700";
  if (status === "LEFT") return "bg-gray-200 text-gray-600";
  return "bg-sky-100 text-sky-700";
}

function cardTypeClass(cardType: string): string {
  return cardType === "PREMIUM" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600";
}

function cardStatusClass(status: string): string {
  return status === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700";
}

function roleClass(role: string): string {
  if (role === "ADMIN") return "bg-purple-100 text-purple-700";
  if (role === "ORGANIZER") return "bg-blue-100 text-blue-700";
  return "bg-gray-100 text-gray-600";
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Convert an ISO timestamp into the local value a datetime-local input needs. */
function dateTimeInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

async function requestJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { credentials: "include", ...init });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "The request failed.");
  }
  return data;
}

export default function AdminOverridesPage() {
  const [tab, setTab] = useState<Tab>("events");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [clientSearch, setClientSearch] = useState("");
  const [eventSearch, setEventSearch] = useState("");

  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [clientForm, setClientForm] = useState({
    name: "",
    email: "",
    username: "",
    phone: "",
  });
  const [savingClient, setSavingClient] = useState(false);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);
  const [eventForm, setEventForm] = useState({
    title: "",
    type: "OTHER",
    coupleNames: "",
    description: "",
    location: "",
    startsAt: "",
    endsAt: "",
    cardTemplateId: "",
  });
  const [savingEvent, setSavingEvent] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const [guestSearch, setGuestSearch] = useState("");
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [guestForm, setGuestForm] = useState({
    fullName: "",
    phone: "",
    whatsapp: "",
    cardType: "STANDARD" as "STANDARD" | "PREMIUM",
  });
  const [attendanceForm, setAttendanceForm] = useState({
    status: "REGISTERED",
    checkedInAt: "",
    notes: "",
  });
  const [savingGuest, setSavingGuest] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const data = (await requestJson("/api/admin/overrides")) as unknown as Overview;
      setOverview({
        clients: Array.isArray(data.clients) ? data.clients : [],
        events: Array.isArray(data.events) ? data.events : [],
      });
      setOverviewError("");
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Unable to load override data.");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await requestJson("/api/admin/overrides")) as unknown as Overview;
        if (cancelled) return;
        setOverview({
          clients: Array.isArray(data.clients) ? data.clients : [],
          events: Array.isArray(data.events) ? data.events : [],
        });
        setOverviewError("");
      } catch (error) {
        if (!cancelled) {
          setOverviewError(
            error instanceof Error ? error.message : "Unable to load override data.",
          );
        }
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;

    let cancelled = false;
    (async () => {
      try {
        const data = (await requestJson(
          `/api/admin/overrides/events/${selectedEventId}`,
        )) as unknown as EventDetail;
        if (cancelled) return;
        setDetail(data);
        setEventForm({
          title: data.title,
          type: data.type,
          coupleNames: data.coupleNames ?? "",
          description: data.description ?? "",
          location: data.location ?? "",
          startsAt: dateTimeInputValue(data.startsAt),
          endsAt: dateTimeInputValue(data.endsAt),
          cardTemplateId: data.cardTemplate?.id ?? "",
        });
      } catch (error) {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : "Unable to load event.");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedEventId, detailVersion]);

  const clients = useMemo(() => overview?.clients ?? [], [overview]);
  const events = useMemo(() => overview?.events ?? [], [overview]);

  const filteredClients = useMemo(() => {
    const query = clientSearch.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) =>
      [client.name, client.email, client.username, client.phone, client.role]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [clients, clientSearch]);

  const filteredEvents = useMemo(() => {
    const query = eventSearch.trim().toLowerCase();
    if (!query) return events;
    return events.filter((event) =>
      [
        event.title,
        event.location,
        event.status,
        event.owner.name,
        event.owner.email,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [events, eventSearch]);

  const selectedGuest = useMemo(
    () => detail?.guests.find((guest) => guest.id === editingGuestId) ?? null,
    [detail, editingGuestId],
  );

  const filteredGuests = useMemo(() => {
    if (!detail) return [];
    const query = guestSearch.trim().toLowerCase();
    if (!query) return detail.guests;
    return detail.guests.filter((guest) =>
      [guest.fullName, guest.email, guest.phone, guest.whatsapp]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [detail, guestSearch]);

  function selectEvent(eventId: string) {
    setEditingGuestId(null);
    setGuestSearch("");
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    setSelectedEventId(eventId);
  }

  function refreshDetail() {
    setDetailError("");
    setDetailLoading(true);
    setDetailVersion((version) => version + 1);
  }

  function startClientEdit(client: ClientAccount) {
    setFeedback(null);
    setEditingClientId(client.id);
    setClientForm({
      name: client.name,
      email: client.email,
      username: client.username ?? "",
      phone: client.phone ?? "",
    });
  }

  async function saveClient(event: FormEvent) {
    event.preventDefault();
    if (!editingClientId) return;
    setSavingClient(true);
    setFeedback(null);
    try {
      await requestJson(`/api/admin/overrides/clients/${editingClientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: clientForm.name,
          email: clientForm.email,
          username: clientForm.username || null,
          phone: clientForm.phone || null,
        }),
      });
      setFeedback({ type: "success", text: "Client information corrected and audited." });
      if (detail?.owner.id === editingClientId) refreshDetail();
      setEditingClientId(null);
      await loadOverview();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to update client information.",
      });
    } finally {
      setSavingClient(false);
    }
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setFeedback(null);

    if (!eventForm.startsAt) {
      setFeedback({ type: "error", text: "The event start date and time are required." });
      return;
    }
    const startsAt = new Date(eventForm.startsAt);
    const endsAt = eventForm.endsAt ? new Date(eventForm.endsAt) : null;
    if (Number.isNaN(startsAt.getTime())) {
      setFeedback({ type: "error", text: "The event start date and time are invalid." });
      return;
    }
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)) {
      setFeedback({ type: "error", text: "The event end must be after the start." });
      return;
    }

    const payload: Record<string, unknown> = {
      title: eventForm.title,
      type: eventForm.type,
      coupleNames: eventForm.coupleNames || null,
      description: eventForm.description || null,
      location: eventForm.location || null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt ? endsAt.toISOString() : null,
    };
    const currentTemplateId = detail.cardTemplate?.id ?? "";
    if (eventForm.cardTemplateId !== currentTemplateId) {
      payload.cardTemplateId = eventForm.cardTemplateId || null;
    }

    setSavingEvent(true);
    try {
      await requestJson(`/api/admin/overrides/events/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setFeedback({ type: "success", text: "Event information corrected and audited." });
      refreshDetail();
      await loadOverview();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to update event.",
      });
    } finally {
      setSavingEvent(false);
    }
  }

  async function changeEventStatus(target: "AUTHORIZED" | "SUSPENDED") {
    if (!detail) return;
    const action = target === "SUSPENDED" ? "suspend" : "reactivate";
    if (!window.confirm(`Are you sure you want to ${action} "${detail.title}"?`)) return;

    setStatusBusy(true);
    setFeedback(null);
    try {
      await requestJson(`/api/admin/overrides/events/${detail.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      setFeedback({
        type: "success",
        text:
          target === "SUSPENDED"
            ? "Event suspended. The new status is audited."
            : "Event reactivated. The new status is audited.",
      });
      refreshDetail();
      await loadOverview();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to change event status.",
      });
    } finally {
      setStatusBusy(false);
    }
  }

  function startGuestEdit(guest: AdminGuest) {
    const attendance = guest.attendances[0];
    setFeedback(null);
    setEditingGuestId(guest.id);
    setGuestForm({
      fullName: guest.fullName,
      phone: guest.phone ?? "",
      whatsapp: guest.whatsapp ?? "",
      cardType: guest.cardType,
    });
    setAttendanceForm({
      status: attendance?.status ?? "REGISTERED",
      checkedInAt: dateTimeInputValue(attendance?.checkedInAt ?? null),
      notes: attendance?.notes ?? "",
    });
  }

  async function saveGuest(event: FormEvent) {
    event.preventDefault();
    if (!detail || !editingGuestId) return;
    setSavingGuest(true);
    setFeedback(null);
    try {
      const data = await requestJson(
        `/api/admin/overrides/events/${detail.id}/guests/${editingGuestId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(guestForm),
        },
      );
      const cardGeneration = data.cardGeneration as
        | { generated?: number; failed?: number; reason?: string }
        | null;
      const cardNote =
        cardGeneration?.reason === "no-template"
          ? " The card is pending because the event has no active design."
          : cardGeneration && cardGeneration.failed
            ? " The card could not be re-rendered; use Regenerate card to retry."
            : "";
      setFeedback({
        type: "success",
        text: `Guest information corrected and audited.${cardNote}`,
      });
      refreshDetail();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to update guest.",
      });
    } finally {
      setSavingGuest(false);
    }
  }

  async function saveAttendance(event: FormEvent) {
    event.preventDefault();
    if (!detail || !editingGuestId) return;
    setSavingAttendance(true);
    setFeedback(null);
    try {
      const noTimestamp = attendanceForm.status === "REGISTERED" || attendanceForm.status === "NO_SHOW";
      const data = await requestJson(
        `/api/admin/overrides/events/${detail.id}/guests/${editingGuestId}/attendance`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: attendanceForm.status,
            checkedInAt:
              noTimestamp || !attendanceForm.checkedInAt
                ? null
                : new Date(attendanceForm.checkedInAt).toISOString(),
            notes: attendanceForm.notes || null,
          }),
        },
      );
      const attendance = data.attendance as Attendance;
      setAttendanceForm({
        status: attendance.status,
        checkedInAt: dateTimeInputValue(attendance.checkedInAt),
        notes: attendance.notes ?? "",
      });
      setFeedback({ type: "success", text: "Attendance corrected and audited." });
      refreshDetail();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to correct attendance.",
      });
    } finally {
      setSavingAttendance(false);
    }
  }

  async function regenerateCard(guest: AdminGuest) {
    if (!detail) return;
    if (!window.confirm(`Regenerate the card for "${guest.fullName}"?`)) return;

    setRegeneratingId(guest.id);
    setFeedback(null);
    try {
      await requestJson(
        `/api/admin/overrides/events/${detail.id}/guests/${guest.id}/card`,
        { method: "POST" },
      );
      setFeedback({
        type: "success",
        text: `Card regenerated for ${guest.fullName}. The action is audited.`,
      });
      refreshDetail();
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "Unable to regenerate the card.",
      });
    } finally {
      setRegeneratingId(null);
    }
  }

  function changeAttendanceStatus(status: string) {
    setAttendanceForm((current) => ({
      ...current,
      status,
      checkedInAt:
        status === "REGISTERED" || status === "NO_SHOW" ? "" : current.checkedInAt,
    }));
  }

  const latestPayment = detail?.payments[0] ?? null;
  const activeTemplate = detail?.cardTemplate?.status === "ACTIVE";

  return (
    <div>
      <header className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
          Controlled overrides
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">Admin data corrections</h2>
        <p className="mt-2 max-w-3xl text-sm text-gray-500">
          Correct client, event, guest, card and attendance records without changing ownership.
          These actions bypass organizer ownership only for administrators, and every successful
          change is written to the AuditLog with actor, action, target and timestamp.
        </p>
      </header>

      {feedback && (
        <div
          role="status"
          className={`mb-6 rounded-lg border px-4 py-3 text-sm font-medium ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {overviewError && overview && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>Could not refresh the override lists: {overviewError}</span>
          <button
            type="button"
            onClick={() => void loadOverview()}
            className="font-bold text-amber-900 underline"
          >
            Retry
          </button>
        </div>
      )}

      <nav className="mb-6 flex gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
        <button
          type="button"
          onClick={() => setTab("events")}
          className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
            tab === "events" ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          Events &amp; guests
          <span className="ml-2 text-xs opacity-75">{events.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("clients")}
          className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
            tab === "clients" ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          Client accounts
          <span className="ml-2 text-xs opacity-75">{clients.length}</span>
        </button>
      </nav>

      {overviewLoading && !overview ? (
        <p className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading override records...
        </p>
      ) : overviewError && !overview ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">Unable to load override records.</p>
          <p className="mt-1">{overviewError}</p>
          <button type="button" onClick={() => void loadOverview()} className={`${PRIMARY_BUTTON} mt-4`}>
            Retry
          </button>
        </div>
      ) : tab === "clients" ? (
        <div>
          {editingClientId && (
            <section className="mb-6 rounded-xl border border-blue-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Correct client information</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Update the account profile. Role and authorization changes remain in Users.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingClientId(null)}
                  className={SECONDARY_BUTTON}
                >
                  Cancel
                </button>
              </div>
              <form onSubmit={saveClient} className="grid gap-4 sm:grid-cols-2">
                <label className={LABEL_CLASS}>
                  Full name
                  <input
                    required
                    maxLength={120}
                    value={clientForm.name}
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, name: event.target.value }))
                    }
                    className={FIELD_CLASS}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Email address
                  <input
                    required
                    type="email"
                    maxLength={254}
                    value={clientForm.email}
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, email: event.target.value }))
                    }
                    className={FIELD_CLASS}
                  />
                </label>
                <label className={LABEL_CLASS}>
                  Username
                  <input
                    maxLength={30}
                    value={clientForm.username}
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, username: event.target.value }))
                    }
                    className={FIELD_CLASS}
                  />
                  <span className="mt-1 block text-xs font-normal text-gray-400">
                    3–30 characters, or leave blank to remove it.
                  </span>
                </label>
                <label className={LABEL_CLASS}>
                  Phone number
                  <input
                    type="tel"
                    maxLength={30}
                    value={clientForm.phone}
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, phone: event.target.value }))
                    }
                    className={FIELD_CLASS}
                  />
                </label>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <button type="submit" disabled={savingClient} className={PRIMARY_BUTTON}>
                    {savingClient ? "Saving..." : "Save client information"}
                  </button>
                  <span className="text-xs text-gray-400">This change will be audited.</span>
                </div>
              </form>
            </section>
          )}

          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Client accounts</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Correct names, emails, usernames and phone numbers used by event owners.
                </p>
              </div>
              <input
                type="search"
                value={clientSearch}
                onChange={(event) => setClientSearch(event.target.value)}
                placeholder="Search clients..."
                aria-label="Search clients"
                className="w-full max-w-xs rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {filteredClients.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                {clients.length === 0 ? "No client accounts found." : "No clients match that search."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                      <th className="px-3 py-3 font-semibold">Client</th>
                      <th className="px-3 py-3 font-semibold">Contact</th>
                      <th className="px-3 py-3 font-semibold">Role</th>
                      <th className="px-3 py-3 font-semibold">Events</th>
                      <th className="px-3 py-3 font-semibold">Joined</th>
                      <th className="px-3 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((client) => (
                      <tr key={client.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-4">
                          <p className="font-semibold text-gray-900">{client.name}</p>
                          <p className="mt-0.5 text-xs text-gray-500">{client.email}</p>
                        </td>
                        <td className="px-3 py-4 text-xs text-gray-600">
                          <p>{client.phone || "No phone"}</p>
                          <p className="mt-0.5 text-gray-400">
                            {client.username ? `@${client.username}` : "No username"}
                          </p>
                        </td>
                        <td className="px-3 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${roleClass(client.role)}`}
                          >
                            {client.role}
                          </span>
                          <p className="mt-1 text-[11px] text-gray-400">{client.authorizationStatus}</p>
                        </td>
                        <td className="px-3 py-4 text-gray-700">
                          {client._count.events} event{client._count.events === 1 ? "" : "s"}
                        </td>
                        <td className="px-3 py-4 text-xs text-gray-600">
                          {new Date(client.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => startClientEdit(client)}
                            className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-600 transition hover:bg-blue-50"
                          >
                            Edit information
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3">
              <h3 className="text-lg font-bold text-gray-900">Events</h3>
              <p className="mt-1 text-xs text-gray-500">
                Select an event to correct its data, guests or attendance.
              </p>
            </div>
            <input
              type="search"
              value={eventSearch}
              onChange={(event) => setEventSearch(event.target.value)}
              placeholder="Search title, client, venue..."
              aria-label="Search events"
              className="mb-3 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
            {filteredEvents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                {events.length === 0 ? "No events found." : "No events match that search."}
              </p>
            ) : (
              <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                {filteredEvents.map((event) => {
                  const active = event.id === selectedEventId;
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => selectEvent(event.id)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        active
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                          : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-gray-900">{event.title}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${eventStatusClass(event.status)}`}
                        >
                          {event.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">{event.owner.name}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {formatDate(event.startsAt)} · {event._count.guests} guest
                        {event._count.guests === 1 ? "" : "s"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="min-w-0">
            {!selectedEventId ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
                <p className="text-lg font-bold text-gray-700">Select an event</p>
                <p className="mt-1 text-sm text-gray-500">
                  Event information, guest corrections, card regeneration and attendance controls
                  will appear here.
                </p>
              </div>
            ) : detailLoading && !detail ? (
              <p className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
                Loading event...
              </p>
            ) : detailError && !detail ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
                <p className="font-semibold">Unable to load this event.</p>
                <p className="mt-1">{detailError}</p>
                <button type="button" onClick={refreshDetail} className={`${PRIMARY_BUTTON} mt-4`}>
                  Retry
                </button>
              </div>
            ) : detail ? (
              <div className="space-y-6">
                {detailError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {detailError}
                  </div>
                )}
                <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-bold text-gray-900">{detail.title}</h3>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${eventStatusClass(detail.status)}`}
                        >
                          {detail.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-gray-500">
                        Owner: <span className="font-semibold text-gray-700">{detail.owner.name}</span>{" "}
                        ({detail.owner.email})
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        {formatDateTime(detail.startsAt)}
                        {detail.endsAt ? ` → ${formatDateTime(detail.endsAt)}` : ""}
                        {detail.location ? ` · ${detail.location}` : ""}
                      </p>
                      {latestPayment && (
                        <p className="mt-1 text-xs text-gray-400">
                          Latest payment: {latestPayment.status} · {Number(latestPayment.amount).toLocaleString()}{" "}
                          {latestPayment.currency}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {detail.status === "AUTHORIZED" && (
                        <button
                          type="button"
                          onClick={() => void changeEventStatus("SUSPENDED")}
                          disabled={statusBusy}
                          className={DANGER_BUTTON}
                        >
                          {statusBusy ? "Working..." : "Suspend event"}
                        </button>
                      )}
                      {detail.status === "SUSPENDED" && (
                        <button
                          type="button"
                          onClick={() => void changeEventStatus("AUTHORIZED")}
                          disabled={statusBusy}
                          className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {statusBusy ? "Working..." : "Reactivate event"}
                        </button>
                      )}
                    </div>
                  </div>
                  {detail.status !== "AUTHORIZED" && detail.status !== "SUSPENDED" && (
                    <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      This event has not been authorized through the payment workflow yet. Use
                      Payments to authorize it before suspend/reactivate controls apply.
                    </p>
                  )}
                  {detail.status === "SUSPENDED" && (
                    <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Reactivation requires a verified payment. The latest payment is currently{" "}
                      <span className="font-bold">{latestPayment?.status ?? "missing"}</span>.
                    </p>
                  )}
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-5">
                    <h3 className="text-lg font-bold text-gray-900">Event information</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Title, schedule, venue and card design. Changing card content invalidates
                      cached personalized cards, which re-render when next opened.
                    </p>
                  </div>
                  <form onSubmit={saveEvent} className="grid gap-4 sm:grid-cols-2">
                    <label className={`${LABEL_CLASS} sm:col-span-2`}>
                      Event title
                      <input
                        required
                        maxLength={200}
                        value={eventForm.title}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, title: event.target.value }))
                        }
                        className={FIELD_CLASS}
                      />
                    </label>
                    <label className={LABEL_CLASS}>
                      Event type
                      <select
                        value={eventForm.type}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, type: event.target.value }))
                        }
                        className={FIELD_CLASS}
                      >
                        <option value="WEDDING">Wedding</option>
                        <option value="CORPORATE">Corporate</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </label>
                    <label className={LABEL_CLASS}>
                      Couple names
                      <input
                        maxLength={2000}
                        value={eventForm.coupleNames}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, coupleNames: event.target.value }))
                        }
                        className={FIELD_CLASS}
                      />
                    </label>
                    <label className={LABEL_CLASS}>
                      Starts at
                      <input
                        required
                        type="datetime-local"
                        value={eventForm.startsAt}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, startsAt: event.target.value }))
                        }
                        className={FIELD_CLASS}
                      />
                    </label>
                    <label className={LABEL_CLASS}>
                      Ends at
                      <input
                        type="datetime-local"
                        value={eventForm.endsAt}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, endsAt: event.target.value }))
                        }
                        className={FIELD_CLASS}
                      />
                      <span className="mt-1 block text-xs font-normal text-gray-400">
                        Optional. Reports unlock after this time.
                      </span>
                    </label>
                    <label className={LABEL_CLASS}>
                      Venue
                      <input
                        maxLength={2000}
                        value={eventForm.location}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, location: event.target.value }))
                        }
                        className={FIELD_CLASS}
                      />
                    </label>
                    <label className={LABEL_CLASS}>
                      Active card design
                      <select
                        value={eventForm.cardTemplateId}
                        onChange={(event) =>
                          setEventForm((current) => ({
                            ...current,
                            cardTemplateId: event.target.value,
                          }))
                        }
                        className={FIELD_CLASS}
                      >
                        <option value="">No design assigned</option>
                        {detail.availableTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.title}
                          </option>
                        ))}
                        {detail.cardTemplate &&
                          !detail.availableTemplates.some(
                            (template) => template.id === detail.cardTemplate?.id,
                          ) && (
                            <option value={detail.cardTemplate.id} disabled>
                              {detail.cardTemplate.title} (not active)
                            </option>
                          )}
                      </select>
                    </label>
                    <label className={`${LABEL_CLASS} sm:col-span-2`}>
                      Description
                      <textarea
                        rows={4}
                        maxLength={2000}
                        value={eventForm.description}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, description: event.target.value }))
                        }
                        className={FIELD_CLASS}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                      <button type="submit" disabled={savingEvent} className={PRIMARY_BUTTON}>
                        {savingEvent ? "Saving..." : "Save event information"}
                      </button>
                      <span className="text-xs text-gray-400">Every successful change is audited.</span>
                    </div>
                  </form>
                </section>

                <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Guests &amp; attendance</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Correct names, phone/WhatsApp details, card type, cards and attendance.
                      </p>
                    </div>
                    <input
                      type="search"
                      value={guestSearch}
                      onChange={(event) => setGuestSearch(event.target.value)}
                      placeholder="Search guests..."
                      aria-label="Search guests"
                      className="w-full max-w-xs rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
                    />
                  </div>

                  {!activeTemplate && (
                    <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Card regeneration is disabled until an active card design is assigned above.
                    </p>
                  )}

                  {selectedGuest && (
                    <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/50 p-5">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="font-bold text-gray-900">{selectedGuest.fullName}</h4>
                          <p className="mt-1 text-xs text-gray-500">
                            {selectedGuest.email || "No email"} · {selectedGuest.phone || "No phone"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditingGuestId(null)}
                          className={SECONDARY_BUTTON}
                        >
                          Close
                        </button>
                      </div>

                      <form onSubmit={saveGuest} className="grid gap-4 sm:grid-cols-2">
                        <label className={`${LABEL_CLASS} sm:col-span-2`}>
                          Guest name
                          <input
                            required
                            maxLength={120}
                            value={guestForm.fullName}
                            onChange={(event) =>
                              setGuestForm((current) => ({
                                ...current,
                                fullName: event.target.value,
                              }))
                            }
                            className={FIELD_CLASS}
                          />
                        </label>
                        <label className={LABEL_CLASS}>
                          Phone
                          <input
                            type="tel"
                            maxLength={30}
                            value={guestForm.phone}
                            onChange={(event) =>
                              setGuestForm((current) => ({ ...current, phone: event.target.value }))
                            }
                            className={FIELD_CLASS}
                          />
                        </label>
                        <label className={LABEL_CLASS}>
                          WhatsApp
                          <input
                            type="tel"
                            maxLength={30}
                            value={guestForm.whatsapp}
                            onChange={(event) =>
                              setGuestForm((current) => ({
                                ...current,
                                whatsapp: event.target.value,
                              }))
                            }
                            className={FIELD_CLASS}
                          />
                        </label>
                        <label className={LABEL_CLASS}>
                          Card type
                          <select
                            value={guestForm.cardType}
                            onChange={(event) =>
                              setGuestForm((current) => ({
                                ...current,
                                cardType: event.target.value as "STANDARD" | "PREMIUM",
                              }))
                            }
                            className={FIELD_CLASS}
                          >
                            <option value="STANDARD">Standard</option>
                            <option value="PREMIUM">Premium</option>
                          </select>
                        </label>
                        <div className="flex items-end">
                          <button type="submit" disabled={savingGuest} className={PRIMARY_BUTTON}>
                            {savingGuest ? "Saving..." : "Save guest details"}
                          </button>
                        </div>
                      </form>

                      <div className="my-5 border-t border-blue-200" />

                      <form onSubmit={saveAttendance} className="grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <h5 className="font-bold text-gray-900">Attendance correction</h5>
                          <p className="mt-1 text-xs text-gray-500">
                            CHECKED_IN counts as attended in reports. REGISTERED/NO_SHOW clears the
                            timestamp; LEFT may keep the original scan time.
                          </p>
                        </div>
                        <label className={LABEL_CLASS}>
                          Status
                          <select
                            value={attendanceForm.status}
                            onChange={(event) => changeAttendanceStatus(event.target.value)}
                            className={FIELD_CLASS}
                          >
                            <option value="REGISTERED">Registered</option>
                            <option value="CHECKED_IN">Checked in</option>
                            <option value="NO_SHOW">No show</option>
                            <option value="LEFT">Left</option>
                          </select>
                        </label>
                        <label className={LABEL_CLASS}>
                          Check-in time
                          <input
                            type="datetime-local"
                            value={attendanceForm.checkedInAt}
                            disabled={
                              attendanceForm.status === "REGISTERED" ||
                              attendanceForm.status === "NO_SHOW"
                            }
                            onChange={(event) =>
                              setAttendanceForm((current) => ({
                                ...current,
                                checkedInAt: event.target.value,
                              }))
                            }
                            className={`${FIELD_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                          />
                          <span className="mt-1 block text-xs font-normal text-gray-400">
                            Leave blank for CHECKED_IN to use the current time.
                          </span>
                        </label>
                        <label className={`${LABEL_CLASS} sm:col-span-2`}>
                          Notes
                          <textarea
                            rows={2}
                            maxLength={1000}
                            value={attendanceForm.notes}
                            onChange={(event) =>
                              setAttendanceForm((current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                            placeholder="Reason for the correction (optional)"
                            className={FIELD_CLASS}
                          />
                        </label>
                        <div className="flex items-center gap-3 sm:col-span-2">
                          <button
                            type="submit"
                            disabled={savingAttendance}
                            className={PRIMARY_BUTTON}
                          >
                            {savingAttendance ? "Saving..." : "Save attendance"}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {filteredGuests.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                      {detail.guests.length === 0
                        ? "This event has no guests yet."
                        : "No guests match that search."}
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1000px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                            <th className="px-3 py-3 font-semibold">Guest</th>
                            <th className="px-3 py-3 font-semibold">Phone</th>
                            <th className="px-3 py-3 font-semibold">WhatsApp</th>
                            <th className="px-3 py-3 font-semibold">Card type</th>
                            <th className="px-3 py-3 font-semibold">Card</th>
                            <th className="px-3 py-3 font-semibold">Attendance</th>
                            <th className="px-3 py-3 font-semibold">Checked in</th>
                            <th className="px-3 py-3 text-right font-semibold">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredGuests.map((guest) => {
                            const attendance = guest.attendances[0];
                            const attendanceStatus = attendance?.status ?? "REGISTERED";
                            const busy = regeneratingId === guest.id;
                            return (
                              <tr key={guest.id} className="border-b border-gray-100 last:border-0">
                                <td className="px-3 py-4">
                                  <p className="font-semibold text-gray-900">{guest.fullName}</p>
                                  {guest.email && (
                                    <p className="mt-0.5 text-xs text-gray-500">{guest.email}</p>
                                  )}
                                </td>
                                <td className="px-3 py-4 text-gray-600">{guest.phone || "—"}</td>
                                <td className="px-3 py-4 text-gray-600">{guest.whatsapp || "—"}</td>
                                <td className="px-3 py-4">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${cardTypeClass(guest.cardType)}`}
                                  >
                                    {guest.cardType}
                                  </span>
                                </td>
                                <td className="px-3 py-4">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${cardStatusClass(guest.cardStatus)}`}
                                  >
                                    {guest.cardStatus}
                                  </span>
                                </td>
                                <td className="px-3 py-4">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${attendanceStatusClass(attendanceStatus)}`}
                                  >
                                    {attendanceStatus.replace("_", " ")}
                                  </span>
                                </td>
                                <td className="px-3 py-4 text-xs text-gray-500">
                                  {formatDateTime(attendance?.checkedInAt ?? null)}
                                </td>
                                <td className="px-3 py-4">
                                  <div className="flex justify-end gap-3 whitespace-nowrap text-xs font-semibold">
                                    <button
                                      type="button"
                                      onClick={() => startGuestEdit(guest)}
                                      className="text-blue-600 hover:underline"
                                    >
                                      Correct
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void regenerateCard(guest)}
                                      disabled={!activeTemplate || busy}
                                      title={
                                        activeTemplate
                                          ? "Re-render this guest's personalized card"
                                          : "Assign an active card design first"
                                      }
                                      className="text-emerald-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
                                    >
                                      {busy ? "Regenerating..." : "Regenerate card"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {detailLoading && (
                  <p className="text-center text-xs font-medium text-gray-400">Refreshing event data...</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
