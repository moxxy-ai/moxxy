import { Pressable, Text, TextInput, View } from 'react-native';
import { MobileIcon } from './MobileIcon';

interface GoalSheetProps {
  readonly objective: string;
  readonly canStart: boolean;
  readonly maxHeight?: number;
  readonly inputMaxHeight?: number;
  readonly onObjectiveChange: (value: string) => void;
  readonly onStart: () => void;
  readonly onClose?: () => void;
}

export function GoalSheet(props: GoalSheetProps) {
  return (
    <View className="gap-4 rounded-card border border-cardBorder bg-cardBg p-4 shadow-card" style={{ maxHeight: props.maxHeight }}>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-[18px] font-black text-text">Start a goal</Text>
        {props.onClose ? (
          <Pressable accessibilityLabel="Close goal" className="h-10 w-10 items-center justify-center rounded-pill" onPress={props.onClose}>
            <MobileIcon name="x" size={19} color="#64748b" />
          </Pressable>
        ) : null}
      </View>
      <TextInput
        value={props.objective}
        onChangeText={props.onObjectiveChange}
        multiline
        placeholder="Describe the objective to accomplish..."
        placeholderTextColor="#94a3b8"
        scrollEnabled
        className="min-h-32 rounded-block border border-cardBorder bg-cardBg px-3 py-3 text-[14px] leading-5 text-text"
        style={{ maxHeight: props.inputMaxHeight }}
      />
      <Pressable
        className={`min-h-11 items-center justify-center rounded-block ${
          props.canStart ? 'bg-primary' : 'bg-cardBorder'
        }`}
        disabled={!props.canStart}
        onPress={props.onStart}
      >
        <Text className="text-[13px] font-bold text-white">Start goal</Text>
      </Pressable>
    </View>
  );
}
