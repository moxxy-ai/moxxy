import { describe, expect, it } from 'vitest';

import { planSpeechProsody } from './speech-prosody.js';

describe('planSpeechProsody', () => {
  it('gives short enthusiastic phrases a livelier cadence', () => {
    expect(planSpeechProsody('Świetnie!')).toEqual({
      rate: 1.06,
      pauseAfterMs: 70,
    });
  });

  it('leaves room after a question without making it sound rushed', () => {
    expect(planSpeechProsody('Czy możemy zaczynać?')).toEqual({
      rate: 1.02,
      pauseAfterMs: 150,
    });
  });

  it('slows reflective ellipses and gives them a longer pause', () => {
    expect(planSpeechProsody('Musimy jednak zrobić to ostrożnie…')).toEqual({
      rate: 0.94,
      pauseAfterMs: 220,
    });
  });

  it('slows a long explanatory sentence slightly', () => {
    expect(
      planSpeechProsody(
        'Najpierw sprawdzimy konfigurację projektu, później uruchomimy wszystkie testy integracyjne, a na końcu zweryfikujemy działanie aplikacji desktopowej.',
      ),
    ).toEqual({ rate: 0.97, pauseAfterMs: 100 });
  });

  it('is deterministic for identical input', () => {
    const first = planSpeechProsody('Jasne, już to sprawdzam.');
    const second = planSpeechProsody('Jasne, już to sprawdzam.');

    expect(second).toEqual(first);
  });
});
