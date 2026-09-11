// Providers auto-refresh section of the Advance Paseo settings screen.
// Editing any setting saves the document and re-arms the daemon-side watcher;
// the status card reports what the watcher last saw and offers a manual
// refresh. All visible text comes from the i18n dictionary.

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
import { useText } from "../i18n/store";
import { format } from "../i18n/dictionaries";

type WatcherStatus = RpcOutput<typeof providersStatusRpc>;

const DEBOUNCE_CHOICES = [
  { label: "0.5 s", value: "500" },
  { label: "1 s", value: "1000" },
  { label: "1.5 s", value: "1500" },
  { label: "3 s", value: "3000" },
] as const;

function formatTimestamp(iso: string | null, emDash: string): string {
  if (iso === null) return emDash;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function ProvidersSettingsSection({ theme }: PluginSurfaceProps) {
  const settings = useSettings(providersSettings);
  const t = useText();
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
      <SettingsSection title={t.providers.sectionTitle}>
        <Text style={mutedStyle}>{t.providers.loading}</Text>
      </SettingsSection>
    );
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title={t.providers.sectionTitle}>
        <Text style={dangerStyle}>{settings.error}</Text>
        <SettingsAction
          label={t.common.couldNotRead}
          actionLabel={t.common.retry}
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

  const watcherHint =
    status === null
      ? t.providers.loading
      : status.armed
        ? format(t.providers.armed, {
            ok: status.watchPaths.filter((item) => item.exists).length,
            total: status.watchPaths.length,
          })
        : t.providers.notArmed;

  return (
    <SettingsSection
      title={t.providers.sectionTitle}
      info={<Text style={mutedStyle}>{t.providers.sectionInfo}</Text>}
    >
      <SettingsCard>
        <SettingsSwitch
          label={t.providers.autoLabel}
          hint={t.providers.autoHint}
          value={values.enabled}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("enabled", value)}
        />
        <SettingsSelect
          label={t.providers.quietLabel}
          hint={t.providers.quietHint}
          value={String(values.debounceMs)}
          options={[...DEBOUNCE_CHOICES]}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("debounceMs", Number(value))}
        />
      </SettingsCard>

      <SettingsCard>
        {values.watchPaths.map((path) => {
          const target = status?.watchPaths.find((item) => item.path === path);
          const hint =
            target === undefined
              ? path
              : target.exists
                ? format(t.providers.fileOk, { path })
                : format(t.providers.fileMissing, { path });
          return (
            <SettingsRow key={path} label={t.providers.watchedFileLabel} hint={hint}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={format(t.providers.removeWatchAlt, { path })}
                onPress={() => void removePath(path)}
              >
                <Text style={dangerStyle}>{t.providers.remove}</Text>
              </Pressable>
            </SettingsRow>
          );
        })}
        <SettingsInput
          label={t.providers.addLabel}
          hint={t.providers.addHint}
          placeholder="~/.codex/config.toml"
          initialValue={newPath}
          onChangeText={setNewPath}
          disabled={busy || settings.saving}
        />
        <SettingsAction
          label={t.providers.addPathLabel}
          actionLabel={t.providers.add}
          disabled={busy || settings.saving || newPath.trim().length === 0}
          onPress={() => void addPath()}
        />
      </SettingsCard>

      <SettingsCard>
        <SettingsRow label={t.providers.watcherLabel} hint={watcherHint}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.providers.reload}
            onPress={() => void refreshStatus()}
          >
            <Text style={linkStyle}>{t.providers.reload}</Text>
          </Pressable>
        </SettingsRow>
        <SettingsRow
          label={t.providers.lastChangeLabel}
          hint={formatTimestamp(status?.lastChangeAt ?? null, t.providers.emDash)}
        />
        <SettingsRow
          label={t.providers.lastRefreshLabel}
          hint={formatTimestamp(status?.lastRefreshAt ?? null, t.providers.emDash)}
        />
        {status?.lastError != null ? (
          <SettingsRow label={t.providers.lastErrorLabel}>
            <Text style={dangerStyle}>{status.lastError}</Text>
          </SettingsRow>
        ) : null}
        <SettingsAction
          label={t.providers.refreshNowLabel}
          hint={t.providers.refreshNowHint}
          actionLabel={t.providers.refresh}
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
