import * as Location from 'expo-location';

export interface Fix {
  lat: number;
  lng: number;
  accuracy_m: number;
}

/**
 * One GPS fix for a check-in. Only asks for "while using the app" permission,
 * never background location. Returns null if denied or slow (the visit is
 * still saved, just without a location).
 */
export async function currentFix(timeoutMs = 8000): Promise<Fix | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (!pos) {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
      return last ? { lat: last.coords.latitude, lng: last.coords.longitude, accuracy_m: last.coords.accuracy ?? 999 } : null;
    }
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy_m: pos.coords.accuracy ?? 999 };
  } catch {
    return null;
  }
}
