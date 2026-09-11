// Providers auto-refresh section of the Advance Paseo settings screen.
// Editing any setting saves the document and re-arms the daemon-side watcher;
// the status card reports what the watcher last saw and offers a manual
// refresh.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import type { RpcOutput } from "@getpaseo/plugin";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import {
  providersArmRpc,
  providersRefreshNowRpc,
  providersSettings,
  providersStatusRpc,
  type ProvidersSettings,
} from "../../shared/providers";

type WatcherStatus = RpcOutput<typeof providersStatusRpc>;

const DEBOUNCE_CHOICES = [
  { label: "0.5 s", value: "500" },
  { label: "1 s", value: "1000" },
  { label: "1.5 s", value: "1500" },
  { label: "3 s", value: "3000" },
] as const;

function formatTimestamp(iso: string | null): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function ProvidersSettingsSection({ theme }: PluginSurfaceProps) {
  const settings = useSettings(providersSettings);
  const armRpc = useRpc(providersArmRpc);
  const statusRpc = useRpc(providersStatusRpc);
  const refreshRpc = useRpc(providersRefreshNowRpc);

  const [status, setStatus] = useState<WatcherStatus | null>(null);
  const [newPath, setNewPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutedStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  const dangerStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);
  const linkStyle = useMemo(() => ({ color: theme.colors.accent }), [theme]);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await statusRpc({}));
    } catch (statusError) {
      console.error("[advance-paseo] watcher status failed", statusError);
    }
  }, [statusRpc]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  if (settings.status === "loading") {
    return (
      <SettingsSection title="Providers auto-refresh">
        <Text style={mutedStyle}>Loading providers settings…</Text>
      </SettingsSection>
    );
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Providers auto-refresh">
        <Text style={dangerStyle}>{settings.error}</Text>
        <SettingsAction
          label="Could not read settings"
          actionLabel="Retry"
          onPress={() => void settings.reload()}
        />
      </SettingsSection>
    );
  }

  const values = settings.values;

  /** Save + re-arm the daemon watcher with the next settings object. */
  const commit = async (next: ProvidersSettings): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const saved = await settings.save(next, settings.revision);
      if (!saved) {
        void settings.reload();
        return;
      }
      await armRpc(next);
      await refreshStatus();
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : String(commitError));
    } finally {
      setBusy(false);
    }
  };

  const change = <Key extends keyof ProvidersSettings>(
    key: Key,
    value: ProvidersSettings[Key],
  ) => {
    void commit({ ...values, [key]: value });
  };

  const addPath = async (): Promise<void> => {
    const path = newPath.trim();
    if (path.length === 0 || values.watchPaths.includes(path)) return;
    setNewPath("");
    await commit({ ...values, watchPaths: [...values.watchPaths, path] });
  };

  const removePath = async (path: string): Promise<void> => {
    await commit({
      ...values,
      watchPaths: values.watchPaths.filter((candidate) => candidate !== path),
    });
  };

  const refreshNow = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await refreshRpc({});
      if (result.error !== null) setError(result.error);
      await refreshStatus();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Providers auto-refresh"
      info={
        <Text style={mutedStyle}>
          Watches provider CLI config files (Claude Code settings by default)
          and refreshes Paseo&apos;s model catalog whenever they change, so new
          models show up without the manual settings refresh.
        </Text>
      }
    >
      <SettingsCard>
        <SettingsSwitch
          label="Auto-refresh"
          hint="Watch the files below and refresh the provider catalog on change"
          value={values.enabled}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("enabled", value)}
        />
        <SettingsSelect
          label="Quiet period"
          hint="Collapses editor save bursts before refreshing"
          value={String(values.debounceMs)}
          options={[...DEBOUNCE_CHOICES]}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("debounceMs", Number(value))}
        />
      </SettingsCard>

      <SettingsCard>
        {values.watchPaths.map((path) => {
          const target = status?.watchPaths.find((item) => item.path === path);
          const existsHint =
            target === undefined ? path : target.exists ? `${path} ✓` : `${path} (missing)`;
          return (
            <SettingsRow key={path} label="Watched file" hint={existsHint}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Stop watching ${path}`}
                onPress={() => void removePath(path)}
              >
                <Text style={dangerStyle}>Remove</Text>
              </Pressable>
            </SettingsRow>
          );
        })}
        <SettingsInput
          label="Add a file to watch"
          hint="Absolute path on the daemon machine; supports ~/ shorthand"
          placeholder="~/.codex/config.toml"
          initialValue={newPath}
          onChangeText={setNewPath}
          disabled={busy || settings.saving}
        />
        <SettingsAction
          label="Add path"
          actionLabel="Add"
          disabled={busy || settings.saving || newPath.trim().length === 0}
          onPress={() => void addPath()}
        />
      </SettingsCard>

      <SettingsCard>
        <SettingsRow
          label="Watcher"
          hint={
            status === null
              ? "Loading status…"
              : status.armed
                ? `Armed · watching ${status.watchPaths.filter((item) => item.exists).length}/${status.watchPaths.length} files`
                : "Not armed"
          }
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reload watcher status"
            onPress={() => void refreshStatus()}
          >
            <Text style={linkStyle}>Reload</Text>
          </Pressable>
        </SettingsRow>
        <SettingsRow label="Last config change" hint={formatTimestamp(status?.lastChangeAt ?? null)} />
        <SettingsRow label="Last catalog refresh" hint={formatTimestamp(status?.lastRefreshAt ?? null)} />
        {status?.lastError != null ? (
          <SettingsRow label="Last error">
            <Text style={dangerStyle}>{status.lastError}</Text>
          </SettingsRow>
        ) : null}
        <SettingsAction
          label="Refresh the provider catalog now"
          hint="Same operation the watcher performs automatically"
          actionLabel="Refresh"
          disabled={busy}
          onPress={() => void refreshNow()}
        />
      </SettingsCard>

      {settings.saveError ? (
        <Text accessibilityRole="alert" style={dangerStyle}>
          {settings.saveError}
        </Text>
      ) : null}
      {error !== null ? (
        <Text accessibilityRole="alert" style={dangerStyle}>
          {error}
        </Text>
      ) : null}
    </SettingsSection>
  );
}
