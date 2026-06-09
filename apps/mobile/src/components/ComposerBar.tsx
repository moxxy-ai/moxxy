import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface ComposerBarProps {
  readonly text: string;
  readonly onTextChange: (value: string) => void;
  readonly onSubmit: () => void;
}

export function ComposerBar({ text, onTextChange, onSubmit }: ComposerBarProps) {
  return (
    <View style={styles.root}>
      <TextInput
        value={text}
        onChangeText={onTextChange}
        multiline
        placeholder="Message"
        placeholderTextColor="#6b7280"
        style={styles.input}
      />
      <Pressable style={styles.button} onPress={onSubmit}>
        <Text style={styles.buttonText}>Send</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: 6,
    borderColor: '#4b5563',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f9fafb',
    backgroundColor: '#0f172a',
  },
  button: {
    minWidth: 76,
    minHeight: 46,
    borderRadius: 6,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
});
