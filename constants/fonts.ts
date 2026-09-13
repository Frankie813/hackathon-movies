import { Platform } from 'react-native';

/**
 * Impact and Copperplate ship as built-in system fonts on iOS but have no
 * preinstalled equivalent on Android, which falls back to the closest stock
 * condensed/serif family there instead of silently rendering the default UI
 * font with no explanation.
 */
export const FONT_IMPACT = Platform.select({
  ios: 'Impact',
  default: 'sans-serif-condensed',
});

export const FONT_COPPERPLATE = Platform.select({
  ios: 'Copperplate',
  default: 'serif',
});
