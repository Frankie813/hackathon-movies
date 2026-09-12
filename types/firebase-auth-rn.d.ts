// Augments firebase/auth with the React Native-only export that TypeScript
// cannot see (issue #2).
//
// @firebase/auth's package.json "exports" lists "types" BEFORE "react-native":
//
//   { "types": "./dist/auth-public.d.ts",          <- tsc matches this first
//     "react-native": { "types": "./dist/rn/index.rn.d.ts", ... } }
//
// Conditional exports are order-sensitive, so tsc always lands on the web
// typings and never reaches the react-native branch — even with Expo's
// customConditions: ["react-native"]. Metro has no such problem: it resolves
// the runtime entry to dist/rn/index.js, where this function really does exist.
//
// So this is a types-only gap. Re-check on firebase upgrades: if the SDK
// reorders those keys, delete this file.
import type { Persistence, ReactNativeAsyncStorage } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(
    storage: ReactNativeAsyncStorage,
  ): Persistence;
}
