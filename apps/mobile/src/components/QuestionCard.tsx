import { sx } from '../styles/tokens';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { UseQuestion } from '@moxxy/client-core';
import { useTheme } from '@/theme/ThemeProvider';
import { questionCardView } from '../questionCardUi';
import { MobileIcon } from './MobileIcon';

/**
 * A Question from the agent on the phone: the suggested answers as chips and,
 * where a question takes one, a field for an answer of your own. It draws what
 * `useQuestion` holds (the same hook the desktop card reads) and hands every
 * pick back to it; the first answer from any client closes it everywhere.
 */
export function QuestionCard({ question }: { readonly question: UseQuestion }) {
  const { colors } = useTheme();
  const open = question.question;
  if (!open) return null;
  const view = questionCardView(open, question.draft);
  const itemOf = (id: string) => open.questions.find((item) => item.id === id);
  const blocked = question.problem !== null || question.sending;

  return (
    <View style={sx('gap-3 rounded-card border border-cardBorder bg-cardBg p-3 shadow-card')}>
      <View style={sx('flex-row items-start gap-3')}>
        <View style={sx('h-9 w-9 items-center justify-center rounded-block bg-primarySoft')}>
          <MobileIcon name="actions" size={17} strokeWidth={2.35} color={colors.primaryStrong} />
        </View>
        <View style={sx('min-w-0 flex-1')}>
          <Text style={sx('text-[15px] font-bold text-text')}>{view.title}</Text>
          <Text style={sx('mt-0.5 text-[12px] leading-4 text-muted')}>The agent is waiting for your answer.</Text>
        </View>
      </View>
      {view.items.map((item) => (
        <View key={item.id} style={sx('gap-2')}>
          {item.header ? <Text style={sx('text-[11px] font-bold text-primaryStrong')}>{item.header}</Text> : null}
          <Text style={sx('text-[14px] leading-5 text-text')}>{item.question}</Text>
          {item.hint ? <Text style={sx('text-[11px] text-muted')}>{item.hint}</Text> : null}
          <View style={sx('flex-row flex-wrap gap-2')}>
            {item.options.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: option.chosen }}
                style={sx(
                  `rounded-block border px-3 py-2 ${option.chosen ? 'border-primary bg-primarySoft' : 'border-cardBorder bg-cardBg'}`,
                )}
                onPress={() => {
                  const target = itemOf(item.id);
                  if (target) question.choose(target, option.id);
                }}
              >
                <Text style={sx('text-[13px] font-bold text-text')}>{option.label}</Text>
                {option.description ? <Text style={sx('text-[11px] text-muted')}>{option.description}</Text> : null}
              </Pressable>
            ))}
          </View>
          {item.takesOwn ? (
            <TextInput
              value={item.own}
              onChangeText={(text) => {
                const target = itemOf(item.id);
                if (target) question.type(target, text);
              }}
              multiline
              accessibilityLabel={`Your own answer to: ${item.question}`}
              placeholder={item.options.length > 0 ? 'Or write your own answer' : 'Write your answer'}
              placeholderTextColor={colors.textDim}
              style={sx('min-h-12 rounded-block border border-cardBorder bg-cardBg px-3 py-2 text-[14px] text-text')}
            />
          ) : null}
        </View>
      ))}
      {question.error ? <Text style={sx('text-[12px] text-red')}>{question.error}</Text> : null}
      <View style={sx('flex-row items-center justify-end gap-2')}>
        {question.problem ? <Text style={sx('min-w-0 flex-1 text-[11px] text-muted')}>{question.problem}</Text> : null}
        <Pressable
          accessibilityLabel="Send answer"
          accessibilityRole="button"
          accessibilityState={{ disabled: blocked }}
          disabled={blocked}
          style={sx(`min-h-9 justify-center rounded-block border border-primary bg-primary px-3 ${blocked ? 'opacity-50' : ''}`)}
          onPress={() => void question.submit()}
        >
          <Text style={sx('text-[13px] font-bold text-white')}>{question.sending ? 'Sending…' : 'Send answer'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
