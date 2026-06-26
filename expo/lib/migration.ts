import AsyncStorage from "@react-native-async-storage/async-storage";

import { Scan } from "@/types";

const MIGRATION_VERSION_KEY = "inflata:migration_version";
const CURRENT_VERSION = "2";

/**
 * Backfill missing fields on scans and items for forward compatibility.
 * Must be called once on app launch, before any scan data is read or displayed.
 * Only runs when the stored migration version is below CURRENT_VERSION.
 * Never throws — wraps in try/catch and falls back to existing data on failure.
 */
export async function runMigrations(): Promise<Scan[]> {
  try {
    const storedVersion = await AsyncStorage.getItem(MIGRATION_VERSION_KEY);
    if (storedVersion === CURRENT_VERSION) return []; // already migrated

    const raw = await AsyncStorage.getItem("inflata:state:v1");
    if (!raw) {
      // No data to migrate — mark version and return
      await AsyncStorage.setItem(MIGRATION_VERSION_KEY, CURRENT_VERSION);
      return [];
    }

    const parsed = JSON.parse(raw) as { scans?: Scan[] };
    const scans: Scan[] = Array.isArray(parsed.scans) ? parsed.scans : [];

    if (scans.length === 0) {
      await AsyncStorage.setItem(MIGRATION_VERSION_KEY, CURRENT_VERSION);
      return [];
    }

    let changed = false;
    const migrated: Scan[] = scans.map((scan) => {
      let scanChanged = false;

      // Backfill scan-level fields
      const backfilledScan: Scan = { ...scan };
      if (!backfilledScan.source) {
        backfilledScan.source = "scan";
        scanChanged = true;
      }
      if (!backfilledScan.store || !String(backfilledScan.store).trim()) {
        backfilledScan.store = "Unknown Store";
        scanChanged = true;
      }

      // Backfill item-level fields
      const backfilledItems = backfilledScan.items.map((item) => {
        let itemChanged = false;
        const backfilled = { ...item };

        // itemKey — generate from normalized name if missing
        if (!backfilled.itemKey || !String(backfilled.itemKey).trim()) {
          backfilled.itemKey = (backfilled.name ?? "")
            .toLowerCase()
            .replace(/\s+/g, "-");
          itemChanged = true;
        }

        // category — let OCR re-assign, don't guess
        // We explicitly set to undefined here, but keep as-is since the
        // requirement says "set to undefined (let OCR assign on next scan — do not guess)"
        // However, item's category field is already optional. We don't modify it.

        // unitPrice — keep undefined if missing (no way to backfill)

        // canonicalUnitPrice — keep undefined if missing

        // isOutlier — default false
        if (backfilled.isOutlier === undefined || backfilled.isOutlier === null) {
          backfilled.isOutlier = false;
          itemChanged = true;
        }

        // quantity — default 1
        if (backfilled.unitQuantity == null || !Number.isFinite(backfilled.unitQuantity)) {
          backfilled.unitQuantity = 1;
          itemChanged = true;
        }

        // unit — default "ea"
        if (!backfilled.unitMeasure || !String(backfilled.unitMeasure).trim()) {
          backfilled.unitMeasure = "ea";
          itemChanged = true;
        }

        // type — default "regular"
        if (!backfilled.type) {
          backfilled.type = "regular";
          itemChanged = true;
        }

        if (itemChanged) changed = true;
        return backfilled;
      });

      if (scanChanged) changed = true;
      return { ...backfilledScan, items: backfilledItems };
    });

    // Write back only if something changed
    if (changed) {
      const persistRaw = await AsyncStorage.getItem("inflata:state:v1");
      if (persistRaw) {
        const persistParsed = JSON.parse(persistRaw);
        persistParsed.scans = migrated;
        await AsyncStorage.setItem("inflata:state:v1", JSON.stringify(persistParsed));
      }
    }

    // Mark migration as complete
    await AsyncStorage.setItem(MIGRATION_VERSION_KEY, CURRENT_VERSION);

    return migrated;
  } catch (e) {
    console.log("[migration] failed", e);
    // Proceed with existing data — never throw
    return [];
  }
}
