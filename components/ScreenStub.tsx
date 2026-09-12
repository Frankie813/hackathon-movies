import { StyleSheet, Text, View } from 'react-native';

interface ScreenStubProps {
  title: string;
  subtitle: string;
}

export function ScreenStub({ title, subtitle }: ScreenStubProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101014',
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 15,
    color: '#9a9aa2',
    textAlign: 'center',
  },
});
