// components/JoinQR.tsx — the host's phone shows this; a guest points a camera
// at it and lands on the join page (issue #19).
//
// Rendering only. Scanning is the phone's own camera app, so there is no
// barcode-scanner dependency here and nothing to ask camera permission for.
//
// There is deliberately no "Open in app" affordance here (issue #90). This card
// is only ever drawn inside MovieMatch, on the screen of someone already in the
// session — a scheme link would hand them off to the app they are holding. That
// handoff belongs to the page a guest actually lands on: public/j/index.html
// offers it, and joinSchemeUrl() in lib/join-link.ts documents the link shape.

import QRCode from 'react-native-qrcode-svg';
import { StyleSheet, Text, View } from 'react-native';

import { isValidCode, normalizeCode } from '@/lib/session';
import { joinUrl } from '@/lib/join-link';

interface JoinQRProps {
  code: string;
  /** Side of the QR itself, in px. The white plate around it is larger. */
  size?: number;
}

export function JoinQR({ code, size = 180 }: JoinQRProps) {
  // A QR for a code that can't be joined is worse than no QR — it scans, it
  // navigates, and the guest gets an error on someone else's phone.
  if (!isValidCode(code)) return null;

  const normalized = normalizeCode(code);
  const url = joinUrl(normalized);

  return (
    <View style={styles.container}>
      {/* Scanners need a light background and a quiet zone. Dark-on-dark, which
          is what the rest of this screen is, reads unreliably or not at all. */}
      <View style={styles.plate}>
        <QRCode
          backgroundColor="#ffffff"
          color="#101014"
          // 'M' survives a camera held at an angle across a table; 'H' would
          // pack in more modules and make each one smaller on a phone screen.
          ecl="M"
          quietZone={8}
          size={size}
          value={url}
        />
      </View>

      {/* The domain is a prize-track detail (PLAN.md §B) — it has to be legible
          in the demo video, not just encoded in the pixels above. It doubles as
          the no-camera path: read it out or send it over text, and the guest's
          browser lands on the join page, which is where "Open in app" lives. */}
      <Text style={styles.url} selectable>
        {url.replace(/^https:\/\//, '')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 10,
  },
  plate: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 12,
  },
  url: {
    color: '#9a9aa2',
    fontSize: 14,
    letterSpacing: 0.3,
  },
});
