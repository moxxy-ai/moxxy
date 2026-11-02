/**
 * Sentences a local voice must read correctly, used by the normalizer's tests
 * and the opt-in live test. `heard` is what a careful listener would write
 * down, so a recognizer's output can be scored against it.
 */

export interface CorpusEntry {
  readonly lang: 'pl' | 'en';
  readonly text: string;
  readonly heard: string;
}

const entry = (lang: 'pl' | 'en', text: string, heard = text): CorpusEntry => ({ lang, text, heard });

export const PRONUNCIATION_CORPUS: readonly CorpusEntry[] = [
  // Plain Polish and English: nothing here may get worse.
  entry('pl', 'Dzień dobry, sprawdzam jak brzmi polski tekst w tej aplikacji.'),
  entry('pl', 'Zadanie zostało zakończone i wszystkie testy przechodzą.'),
  entry('pl', 'Czy mam od razu wysłać te zmiany na serwer?'),
  entry('en', 'Hello. This is how your replies will sound.'),
  entry('en', 'The task is finished and every test passes.'),
  // Whole numbers.
  entry('pl', 'Mam 7 plików.'),
  entry('pl', 'Mam 23 pliki.'),
  entry('pl', 'W repozytorium są 4382 testy.'),
  entry('pl', 'Projekt ma 1 000 000 użytkowników.'),
  entry('pl', 'Na liście jest 105 pozycji.'),
  entry('en', 'There are 4382 tests in the repository.'),
  entry('en', 'We have 1,250 users today.'),
  // Money.
  entry('pl', 'Koszt to 1500 zł.'),
  entry('pl', 'Zapłać 29,99 zł albo 15 € lub $20.', 'Zapłać 29,99 zł albo 15 euro lub 20 dolarów.'),
  entry('pl', 'Budżet to 1,5 mln zł.', 'Budżet to półtora miliona złotych.'),
  entry('pl', 'Dostałem fakturę na 2 tys. zł.', 'Dostałem fakturę na 2000 zł.'),
  entry('en', 'It costs $1,500.'),
  entry('en', 'It costs €15.99.'),
  entry('en', 'The budget is $2.5 million.'),
  // Percent and arithmetic.
  entry('pl', 'Rabat wynosi 50%.'),
  entry('pl', 'Pokrycie wzrosło o 12,5%.'),
  entry('pl', 'Pół to 1/2, a 2+2=4.', 'Pół to jedna druga, a 2 plus 2 równa się 4.'),
  entry('en', 'Coverage is about 10%.'),
  entry('en', 'Half is 1/2 and 2+2=4.', 'Half is one half and 2 plus 2 equals 4.'),
  // Dates.
  entry('pl', 'Spotkanie jest 12.05.2026.', 'Spotkanie jest 12 maja 2026.'),
  entry('pl', 'Termin to 2026-03-01.', 'Termin to 1 marca 2026.'),
  entry('pl', 'Wysyłka była 3 maja 2025 roku.'),
  entry('en', 'The release is on 2026-03-01.', 'The release is on March 1, 2026.'),
  entry('en', 'Meet me on Jan. 5, 2026.', 'Meet me on January 5, 2026.'),
  // Times.
  entry('pl', 'Zaczynamy o 14:30.'),
  entry('pl', 'Budzik dzwoni o 8:05.'),
  entry('en', 'Meet at 5:30 PM.'),
  entry('en', 'The call is at 09:15.', 'The call is at 9:15.'),
  // Units.
  entry('pl', 'Trasa ma 5 km, a walizka waży 3 kg.'),
  entry('pl', 'Dysk ma 50 GB, a plik 120 MB.'),
  entry('pl', 'Na dworze jest 20°C i -5 stopni w nocy.', 'Na dworze jest 20 stopni i minus 5 stopni w nocy.'),
  entry('pl', 'Jechał 50 km/h przez miasto.', 'Jechał 50 kilometrów na godzinę przez miasto.'),
  entry('pl', 'Odpowiedź zajęła 250 ms.', 'Odpowiedź zajęła 250 milisekund.'),
  entry('en', 'It used 120 MB of memory.'),
  entry('en', 'It weighs 20 kg.'),
  entry('en', 'She drove at 50 km/h.', 'She drove at 50 kilometers per hour.'),
  // Ordinals.
  entry('pl', 'Zajął 2. miejsce.', 'Zajął drugie miejsce.'),
  entry('pl', 'To jest 3. wersja.', 'To jest trzecia wersja.'),
  entry('en', 'She came 3rd.', 'She came third.'),
  entry('en', 'This is the 21st build.', 'This is the twenty-first build.'),
  // Decimals and versions.
  entry('pl', 'Czekam 1,5 sekundy.'),
  entry('pl', 'Wersja 2.0 jest gotowa.'),
  entry('pl', 'Wersja v1.2.3 trafiła do repozytorium.', 'Wersja 1.2.3 trafiła do repozytorium.'),
  entry('en', 'The build took 3.5 seconds.'),
  entry('en', 'Version v1.2.3 is out.', 'Version 1.2.3 is out.'),
  // Abbreviations.
  entry('pl', 'Lubię owoce, np. jabłka, gruszki itd.', 'Lubię owoce, na przykład jabłka, gruszki i tak dalej.'),
  entry('pl', 'Dr Kowalski mieszka przy ul. Długiej 5.', 'Doktor Kowalski mieszka przy ulicy Długiej 5.'),
  entry('pl', 'Zadanie nr 7, pkt 3, godz. 8:05.', 'Zadanie numer 7, punkt 3, godzina 8:05.'),
  entry('pl', 'Testy obejmują m.in. logowanie.', 'Testy obejmują między innymi logowanie.'),
  entry('pl', 'Trwało to ok. 5 min.', 'Trwało to około 5 minut.'),
  entry('en', 'Dr. Smith vs. Mr. Jones.', 'Doctor Smith versus Mister Jones.'),
  entry('en', 'Use a helper, e.g. this one.', 'Use a helper, for example this one.'),
  // Symbols.
  entry('pl', 'Napisz na jan@example.com w sprawie #123.', 'Napisz na jan małpa example kropka com w sprawie numer 123.'),
  entry('pl', 'Język C++ oraz A&B.', 'Język C plus plus oraz A i B.'),
  entry('en', 'Write to jan@example.com about #123.', 'Write to jan at example dot com about number 123.'),
  entry('en', 'We use C++ and A&B.', 'We use C plus plus and A and B.'),
  // Acronyms.
  entry('pl', 'Używamy API, URL, AI, USB i CPU.'),
  entry('pl', 'Serwer zwraca JSON przez HTTP.'),
  entry('pl', 'Dane z NASA trafiają do PDF.'),
  entry('en', 'We use API, URL, AI, USB and CPU.'),
  entry('en', 'The server returns JSON over HTTP.'),
  // Roman numerals.
  entry('pl', 'Jan III Sobieski żył w XVII wieku.', 'Jan Trzeci Sobieski żył w siedemnastym wieku.'),
  entry('pl', 'To jest rozdział IV.', 'To jest rozdział czwarty.'),
  entry('en', 'King Henry VIII lived in the XVI century.', 'King Henry the Eighth lived in the sixteenth century.'),
  // English names inside Polish sentences.
  entry('pl', 'Używam TypeScript i React w tym projekcie.'),
  entry('pl', 'Otwórz GitHub Actions i sprawdź pipeline.'),
  entry('pl', 'Wyślij pull request do brancha development.'),
  entry('pl', 'To jest Claude Code, a nie Visual Studio Code.'),
  entry('pl', 'Otwórz plik package.json i uruchom pnpm test.'),
  entry('pl', 'Zrób commit i push na GitHub.'),
  entry('pl', 'Backend działa na Node, a frontend na React.'),
  entry('pl', 'Docker i Kubernetes działają w chmurze.'),
  entry('pl', 'Sprawdź to w Google Chrome albo Safari.'),
  entry('pl', 'Ten feature wymaga refactoringu.'),
  entry('pl', 'OpenAI i Anthropic mają swoje modele.'),
];
