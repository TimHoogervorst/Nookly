"use client";

import { useState, useEffect } from "react";

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    endpoint: "",
    api_key: "",
    model: "gpt-3.5-turbo",
    embedding_endpoint: "",
    embedding_model: "text-embedding-ada-002",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  // Password change
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwMessage, setPwMessage] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setSettings((prev) => ({
            ...prev,
            ...data,
            // If api_key is masked, keep it empty in the form
            api_key: data.api_key?.startsWith("••••") ? "" : data.api_key || "",
          }));
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage("");

    try {
      // Only include values that are actually set
      const toSave: Record<string, string> = {};
      if (settings.endpoint) toSave.endpoint = settings.endpoint;
      if (settings.api_key) toSave.api_key = settings.api_key;
      if (settings.model) toSave.model = settings.model;
      if (settings.embedding_endpoint)
        toSave.embedding_endpoint = settings.embedding_endpoint;
      if (settings.embedding_model)
        toSave.embedding_model = settings.embedding_model;

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });

      if (res.ok) {
        setMessage("Settings saved successfully!");
        // Clear API key field after save for security
        setSettings((prev) => ({ ...prev, api_key: "" }));
      } else {
        const data = await res.json();
        setMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwMessage("");
    if (newPassword !== confirmPassword) {
      setPwMessage("New passwords do not match");
      return;
    }
    if (newPassword.length < 6) {
      setPwMessage("New password must be at least 6 characters");
      return;
    }
    setChangingPw(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPwMessage("Password changed successfully!");
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPwMessage(`Error: ${data.error}`);
      }
    } catch {
      setPwMessage("Failed to change password");
    } finally {
      setChangingPw(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 p-6 max-w-2xl mx-auto w-full overflow-auto">
        <p className="text-gray-500">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 max-w-2xl mx-auto w-full overflow-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Settings</h1>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            LLM API Endpoint URL
          </label>
          <input
            type="url"
            value={settings.endpoint}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, endpoint: e.target.value }))
            }
            placeholder="https://api.openai.com/v1/chat/completions"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            Any OpenAI-compatible endpoint (OpenAI, Ollama, Groq, Together, etc.)
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            API Key
          </label>
          <input
            type="password"
            value={settings.api_key}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, api_key: e.target.value }))
            }
            placeholder="sk-..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <p className="text-xs text-gray-400 mt-1">
            Leave blank to keep existing key unchanged
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Chat Model
          </label>
          <input
            type="text"
            value={settings.model}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, model: e.target.value }))
            }
            placeholder="gpt-3.5-turbo"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div className="border-t border-gray-200 pt-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Embeddings (for RAG)
          </h2>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Embedding API Endpoint (optional)
            </label>
            <input
              type="url"
              value={settings.embedding_endpoint}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  embedding_endpoint: e.target.value,
                }))
              }
              placeholder="Uses chat endpoint by default"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              Only needed if embeddings use a different base URL than chat
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Embedding Model
            </label>
            <input
              type="text"
              value={settings.embedding_model}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  embedding_model: e.target.value,
                }))
              }
              placeholder="text-embedding-ada-002"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>

        {message && (
          <div
            className={`p-3 rounded-lg text-sm ${
              message.startsWith("Error") || message.startsWith("Failed")
                ? "bg-red-50 text-red-700 border border-red-200"
                : "bg-green-50 text-green-700 border border-green-200"
            }`}
          >
            {message}
          </div>
        )}

        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Account</h2>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Current Password
            </label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <button
            onClick={handleChangePassword}
            disabled={changingPw || !oldPassword || !newPassword || !confirmPassword}
            className="w-full py-2.5 bg-gray-700 dark:bg-gray-600 text-white rounded-lg font-medium hover:bg-gray-800 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {changingPw ? "Changing..." : "Change Password"}
          </button>

          {pwMessage && (
            <div
              className={`mt-3 p-3 rounded-lg text-sm ${
                pwMessage.startsWith("Error") || pwMessage.startsWith("Failed") || pwMessage.startsWith("New")
                  ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/30"
                  : "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/30"
              }`}
            >
              {pwMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
