"use client";

import { useEffect, useState } from "react";

interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  name: string;
  role: "ADMIN" | "ORGANIZER" | "STAFF";
  authorizationStatus: "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  createdAt: string;
  _count: { events: number; payments: number; cardTemplates: number };
}

const ROLES = ["ADMIN", "ORGANIZER", "STAFF"] as const;
const AUTH_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;

const roleBadgeClass: Record<AdminUser["role"], string> = {
  ADMIN: "bg-purple-100 text-purple-700",
  ORGANIZER: "bg-blue-100 text-blue-700",
  STAFF: "bg-gray-100 text-gray-600",
};

const authBadgeClass: Record<AdminUser["authorizationStatus"], string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  SUSPENDED: "bg-gray-100 text-gray-600",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (res.ok && Array.isArray(data.users)) {
        setUsers(data.users);
        setCurrentUserId(data.currentUserId ?? null);
      } else if (!res.ok) {
        setError(data.error || "Failed to load users");
      }
    } catch {
      setError("Failed to load users");
    }
  }

  async function patchUser(userId: string, payload: Record<string, unknown>, successMessage: string) {
    setError("");
    setSuccess("");
    setBusyId(userId);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update user");
        return;
      }
      setSuccess(successMessage);
      fetchUsers();
    } catch {
      setError("Unable to connect to the user service.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(user: AdminUser) {
    if (!window.confirm(`Permanently delete ${user.name} (${user.email})? This cannot be undone.`)) return;
    setError("");
    setSuccess("");
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to delete user");
        return;
      }
      setSuccess(`${user.email} was deleted.`);
      fetchUsers();
    } catch {
      setError("Unable to connect to the user service.");
    } finally {
      setBusyId(null);
    }
  }

  const selectClass =
    "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50";

  return (
    <div>
      <header className="mb-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Admin settings</p>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">Account manager</h2>
        <p className="mt-2 text-sm text-gray-500">
          Change roles and authorization statuses, or delete unused test accounts.
          Accounts that own events, payments or templates cannot be deleted.
        </p>
      </header>

        {error && <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
        {success && <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{success}</div>}

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-gray-900">All accounts</h2>
            <p className="mt-1 text-sm text-gray-500">
              {users.length} account{users.length === 1 ? "" : "s"} registered. Your own role cannot be changed and your own account cannot be deleted.
            </p>
          </div>
          {users.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">No accounts found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-3 font-semibold">Account</th>
                    <th className="px-3 py-3 font-semibold">Role</th>
                    <th className="px-3 py-3 font-semibold">Authorization</th>
                    <th className="px-3 py-3 font-semibold">Data</th>
                    <th className="px-3 py-3 font-semibold">Joined</th>
                    <th className="px-3 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSelf = user.id === currentUserId;
                    const hasData = user._count.events + user._count.payments + user._count.cardTemplates > 0;
                    const busy = busyId === user.id;
                    const deleteBlocked = isSelf || hasData;
                    return (
                      <tr key={user.id} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-4">
                          <p className="font-semibold text-gray-800">{user.name}</p>
                          <p className="mt-0.5 text-xs text-gray-500">{user.email}{user.username ? ` · @${user.username}` : ""}</p>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${roleBadgeClass[user.role]}`}>{user.role}</span>
                            {!isSelf && (
                              <select
                                value={user.role}
                                disabled={busy}
                                onChange={(event) => patchUser(user.id, { role: event.target.value }, `Role of ${user.email} changed to ${event.target.value}.`)}
                                className={selectClass}
                                aria-label={`Role of ${user.email}`}
                              >
                                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                              </select>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${authBadgeClass[user.authorizationStatus]}`}>{user.authorizationStatus}</span>
                            <select
                              value={user.authorizationStatus}
                              disabled={busy}
                              onChange={(event) => patchUser(user.id, { authorizationStatus: event.target.value }, `Authorization of ${user.email} set to ${event.target.value}.`)}
                              className={selectClass}
                              aria-label={`Authorization status of ${user.email}`}
                            >
                              {AUTH_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-4 text-xs text-gray-600">
                          {user._count.events} event{user._count.events === 1 ? "" : "s"} · {user._count.payments} payment{user._count.payments === 1 ? "" : "s"}
                          {user._count.cardTemplates > 0 ? ` · ${user._count.cardTemplates} template(s)` : ""}
                        </td>
                        <td className="px-3 py-4 text-xs text-gray-600">{new Date(user.createdAt).toLocaleDateString()}</td>
                        <td className="px-3 py-4">
                          <button
                            onClick={() => handleDelete(user)}
                            disabled={deleteBlocked || busy}
                            title={isSelf ? "You cannot delete your own account" : hasData ? "This account owns events, payments or templates" : undefined}
                            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                          >
                            {busy ? "Working…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
    </div>
  );
}
