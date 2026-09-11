// Wallpaper section of the Advance Paseo settings screen. Edits persist
// through the host-scoped settings document and reach the wallpaper engine
// immediately for live feedback.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { isWebPlatform, pickWallpaperImage } from "../web";
import {
  applyWallpaperState,
  engineStateOf,
  setWallpaperImages,
  type WallpaperImages,
} from "./engine";
import { resolveWallpaperImagesWith, type WallpaperReader } from "./loader";
import { ACCENT_CHOICES, BLUR_LEVELS, SCRIM_LEVELS } from "./palettes";
import {
  wallpaperDeleteRpc,
  wallpaperListRpc,
  wallpaperReadPathRpc,
  wallpaperReadRpc,
  wallpaperSettings,
  wallpaperUploadRpc,
  type WallpaperMeta,
  type WallpaperSettings,
  type WallpaperSource,
} from "../../shared/wallpaper";

type WallpaperSlot = "light" | "dark";

const MODE_CHOICES = [
  { label: "Plugin themes only (reliable)", value: "plugin-themes" as const },
  { label: "Any theme (heuristic)", value: "any-theme" as const },
];

function describeSource(
  source: WallpaperSource | null,
  library: readonly WallpaperMeta[],
): string {
  if (source === null) return "None";
  if (source.kind === "path") return source.path;
  const meta = library.find((item) => item.id === source.id);
  return meta !== undefined ? meta.name : `Imported (${source.id.slice(0, 8)})`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

export function WallpaperSettingsSection({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(wallpaperSettings);
  const listRpc = useRpc(wallpaperListRpc);
  const uploadRpc = useRpc(wallpaperUploadRpc);
  const deleteRpc = useRpc(wallpaperDeleteRpc);
  const readRpc = useRpc(wallpaperReadRpc);
  const readPathRpc = useRpc(wallpaperReadPathRpc);

  const [library, setLibrary] = useState<readonly WallpaperMeta[]>([]);
  const [previews, setPreviews] = useState<WallpaperImages>({ light: null, dark: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathDrafts, setPathDrafts] = useState<Record<WallpaperSlot, string>>({
    light: "",
    dark: "",
  });

  const mutedStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  const dangerStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);
  const linkStyle = useMemo(
    () => ({ color: theme.colors.accent, fontSize: layout.compact ? 13 : 14 }),
    [theme, layout.compact],
  );

  const reader = useMemo<WallpaperReader>(
    () => ({
      readManaged: (id) => readRpc({ id }).then((result) => result.dataUrl),
      readPath: (path) => readPathRpc({ path }).then((result) => result.dataUrl),
    }),
    [readRpc, readPathRpc],
  );

  const valuesKey =
    settings.status === "ready" ? JSON.stringify(settings.values) : "";
  const slotsKey =
    settings.status === "ready"
      ? JSON.stringify([settings.values.light, settings.values.dark])
      : "";

  const refreshLibrary = useCallback(async () => {
    try {
      const result = await listRpc({});
      setLibrary(result.items);
    } catch (listError) {
      console.error("[advance-paseo] wallpaper list failed", listError);
    }
  }, [listRpc]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  // Apply persisted values as soon as they arrive; this also covers hosts
  // where the entry-time RPC read could not run.
  useEffect(() => {
    if (settings.status === "ready") applyWallpaperState(engineStateOf(settings.values));
  }, [valuesKey, settings.status]); // valuesKey captures the values

  // Preview images reload only when the picked slots change, not on style
  // tweaks, to avoid re-transferring megabytes on every switch flip.
  useEffect(() => {
    if (settings.status !== "ready") return;
    void resolveWallpaperImagesWith(reader, settings.values)
      .then(setPreviews)
      .catch(() => setPreviews({ light: null, dark: null }));
  }, [slotsKey, settings.status, reader]); // eslint-disable-line react-hooks/exhaustive-deps

  if (settings.status === "loading") {
    return (
      <SettingsSection title="Wallpaper">
        <Text style={mutedStyle}>Loading wallpaper settings…</Text>
      </SettingsSection>
    );
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Wallpaper">
        <Text style={dangerStyle}>{settings.error}</Text>
        <SettingsAction
          label="Could not read settings"
          actionLabel="Retry"
          onPress={() => void settings.reload()}
        />
        {settings.status === "invalid" ? (
          <SettingsAction
            label="Stored values are invalid"
            actionLabel="Restore defaults"
            onPress={() => void settings.reset()}
          />
        ) : null}
      </SettingsSection>
    );
  }

  const values = settings.values;

  /** Apply + persist a full settings object, resolving slot images eagerly. */
  const commit = async (next: WallpaperSettings): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      applyWallpaperState(engineStateOf(next));
      const images = await resolveWallpaperImagesWith(reader, next);
      setWallpaperImages(images);
      setPreviews(images);
      const saved = await settings.save(next, settings.revision);
      if (!saved) void settings.reload();
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : String(commitError));
    } finally {
      setBusy(false);
    }
  };

  const change = <Key extends keyof WallpaperSettings>(
    key: Key,
    value: WallpaperSettings[Key],
  ) => {
    void commit({ ...values, [key]: value });
  };

  const importIntoSlot = async (slot: WallpaperSlot): Promise<void> => {
    const picked = await pickWallpaperImage();
    if (picked === null) {
      if (!isWebPlatform()) setError("Importing images needs the desktop or web app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const upload = await uploadRpc({ name: picked.name, dataUrl: picked.dataUrl });
      await refreshLibrary();
      await commit({ ...values, [slot]: { kind: "managed", id: upload.wallpaper.id } });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setBusy(false);
    }
  };

  const importToLibrary = async (): Promise<void> => {
    const picked = await pickWallpaperImage();
    if (picked === null) {
      if (!isWebPlatform()) setError("Importing images needs the desktop or web app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadRpc({ name: picked.name, dataUrl: picked.dataUrl });
      await refreshLibrary();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError));
    } finally {
      setBusy(false);
    }
  };

  const applyPath = async (slot: WallpaperSlot): Promise<void> => {
    const path = pathDrafts[slot].trim();
    if (path.length === 0) return;
    await commit({ ...values, [slot]: { kind: "path", path } });
    setPathDrafts((drafts) => ({ ...drafts, [slot]: "" }));
  };

  const clearSlot = async (slot: WallpaperSlot): Promise<void> => {
    await commit({ ...values, [slot]: null });
  };

  const useFor = async (slot: WallpaperSlot, item: WallpaperMeta): Promise<void> => {
    await commit({ ...values, [slot]: { kind: "managed", id: item.id } });
  };

  const removeItem = async (item: WallpaperMeta): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Clear any slot that referenced the item so reads never fail.
      const next: WallpaperSettings = { ...values };
      if (next.light?.kind === "managed" && next.light.id === item.id) next.light = null;
      if (next.dark?.kind === "managed" && next.dark.id === item.id) next.dark = null;
      if (next.light !== values.light || next.dark !== values.dark) {
        await commit(next);
      }
      await deleteRpc({ id: item.id });
      await refreshLibrary();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Wallpaper"
      info={
        <Text style={mutedStyle}>
          Paints any image behind chat and glass surfaces. Works in the desktop
          and web apps; mobile keeps Paseo&apos;s native surfaces.
        </Text>
      }
    >
      <SettingsCard>
        <SettingsSwitch
          label="Wallpaper"
          hint="Master switch for the painting enhancement"
          value={values.enabled}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("enabled", value)}
        />
        <SettingsSelect
          label="Active when"
          hint={
            values.mode === "plugin-themes"
              ? "Only while an Advance or Miku theme is selected"
              : "Over any theme, following the detected light/dark interface"
          }
          value={values.mode}
          options={MODE_CHOICES}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("mode", value)}
        />
        <SettingsSelect
          label="Visibility"
          value={values.scrim}
          options={SCRIM_LEVELS}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("scrim", value)}
        />
        <SettingsSelect
          label="Glass blur"
          value={values.blur}
          options={BLUR_LEVELS}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("blur", value)}
        />
        <SettingsSelect
          label="Message accent"
          value={values.accent}
          options={ACCENT_CHOICES}
          disabled={busy || settings.saving}
          onValueChange={(value) => change("accent", value)}
        />
      </SettingsCard>

      {(["light", "dark"] as const).map((slot) => (
        <SettingsCard key={slot}>
          <SettingsRow
            label={`${slot === "light" ? "Light" : "Dark"} wallpaper`}
            hint={describeSource(values[slot], library)}
          >
            {previews[slot] !== null ? (
              <Image
                source={{ uri: previews[slot] ?? undefined }}
                style={{
                  width: 96,
                  height: 54,
                  borderRadius: 8,
                  marginLeft: layout.compact ? 8 : 12,
                }}
                resizeMode="cover"
                accessibilityLabel={`${slot} wallpaper preview`}
              />
            ) : null}
          </SettingsRow>
          <SettingsAction
            label="Import image…"
            hint="Pick a file; it is optimized and stored on the daemon"
            actionLabel="Choose file"
            disabled={busy || settings.saving}
            onPress={() => void importIntoSlot(slot)}
          />
          <SettingsInput
            label="Or reference a path"
            hint="Read on the daemon machine; supports ~/ shorthand"
            placeholder="C:\pictures\wallpaper.webp"
            initialValue={pathDrafts[slot]}
            onChangeText={(text) =>
              setPathDrafts((drafts) => ({ ...drafts, [slot]: text }))
            }
            disabled={busy || settings.saving}
          />
          <SettingsAction
            label="Apply path"
            actionLabel="Apply"
            disabled={busy || settings.saving || pathDrafts[slot].trim().length === 0}
            onPress={() => void applyPath(slot)}
          />
          {values[slot] !== null ? (
            <SettingsAction
              label="Clear this slot"
              actionLabel="Clear"
              disabled={busy || settings.saving}
              onPress={() => void clearSlot(slot)}
            />
          ) : null}
        </SettingsCard>
      ))}

      <SettingsCard>
        <SettingsAction
          label="Import to library"
          hint={`${library.length} image${library.length === 1 ? "" : "s"} stored on the daemon`}
          actionLabel="Choose file"
          disabled={busy || settings.saving}
          onPress={() => void importToLibrary()}
        />
        {library.map((item) => (
          <SettingsRow
            key={item.id}
            label={item.name}
            hint={`${formatBytes(item.bytes)} · ${new Date(item.addedAt).toLocaleDateString()}`}
          >
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Use ${item.name} for light mode`}
                onPress={() => void useFor("light", item)}
              >
                <Text style={linkStyle}>Light</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Use ${item.name} for dark mode`}
                onPress={() => void useFor("dark", item)}
              >
                <Text style={linkStyle}>Dark</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${item.name}`}
                onPress={() => void removeItem(item)}
              >
                <Text style={dangerStyle}>Delete</Text>
              </Pressable>
            </View>
          </SettingsRow>
        ))}
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
