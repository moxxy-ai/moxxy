import { describe, expect, it } from 'vitest';

import { PRONUNCIATION_CORPUS } from '../__fixtures__/pronunciation-corpus.js';
import { normalizeForSpeech } from './index.js';

describe('normalizeForSpeech: Polish', () => {
  it.each([
    ['Mam 7 plików.', 'Mam siedem plików.'],
    ['Mam 23 pliki.', 'Mam dwadzieścia trzy pliki.'],
    ['W repozytorium są 4382 testy.', 'W repozytorium są cztery tysiące trzysta osiemdziesiąt dwa testy.'],
    ['Projekt ma 1 000 000 użytkowników.', 'Projekt ma milion użytkowników.'],
    ['Na liście jest 105 pozycji.', 'Na liście jest sto pięć pozycji.'],
    ['Zero to 0.', 'Zero to zero.'],
    ['Numer 007 wrócił.', 'Numer zero zero siedem wrócił.'],
    ['Telefon 123456789012345 nie działa.', 'Telefon jeden dwa trzy cztery pięć sześć siedem osiem dziewięć zero jeden dwa trzy cztery pięć nie działa.'],
    ['Czekam 2 godziny.', 'Czekam dwie godziny.'],
    ['Została 1 osoba.', 'Została jedna osoba.'],
    ['Czekam 22 minuty.', 'Czekam dwadzieścia dwie minuty.'],
  ])('reads whole numbers: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Koszt to 1500 zł.', 'Koszt to tysiąc pięćset złotych.'],
    ['Koszt to 1 zł.', 'Koszt to jeden złoty.'],
    ['Koszt to 2 zł.', 'Koszt to dwa złote.'],
    ['Koszt to 22 zł.', 'Koszt to dwadzieścia dwa złote.'],
    ['Koszt to 12 zł.', 'Koszt to dwanaście złotych.'],
    ['Zapłać 29,99 zł.', 'Zapłać dwadzieścia dziewięć złotych dziewięćdziesiąt dziewięć groszy.'],
    ['Zapłać 15 € lub $20.', 'Zapłać piętnaście euro lub dwadzieścia dolarów.'],
    ['Zapłać 3,50 €.', 'Zapłać trzy euro pięćdziesiąt centów.'],
    ['Budżet to 1,5 mln zł.', 'Budżet to półtora miliona złotych.'],
    ['Budżet to 2,5 mld zł.', 'Budżet to dwa i pół miliarda złotych.'],
    ['Faktura na 2 tys. zł.', 'Faktura na dwa tysiące złotych.'],
    ['Faktura na 5 tys. zł.', 'Faktura na pięć tysięcy złotych.'],
  ])('reads money: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Rabat wynosi 50%.', 'Rabat wynosi pięćdziesiąt procent.'],
    ['Wzrost o 12,5%.', 'Wzrost o dwanaście i pół procenta.'],
    ['Liczba 3,05 to mało.', 'Liczba trzy przecinek zero pięć to mało.'],
    ['Pół to 1/2.', 'Pół to jedna druga.'],
    ['Zjadł 3/4 ciasta.', 'Zjadł trzy czwarte ciasta.'],
    ['Działa 24/7.', 'Działa dwadzieścia cztery na siedem.'],
    ['Wynik: 2+2=4.', 'Wynik: dwa plus dwa równa się cztery.'],
    ['Czekam 1,5 sekundy.', 'Czekam półtorej sekundy.'],
    ['Liczba 3,14 jest znana.', 'Liczba trzy przecinek czternaście jest znana.'],
  ])('reads percents and fractions: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Spotkanie jest 12.05.2026.', 'Spotkanie jest dwunastego maja dwa tysiące dwudziestego szóstego.'],
    ['Termin to 2026-03-01.', 'Termin to pierwszego marca dwa tysiące dwudziestego szóstego.'],
    ['Termin to 12/05/2026.', 'Termin to dwunastego maja dwa tysiące dwudziestego szóstego.'],
    ['Wysyłka była 3 maja 2025 roku.', 'Wysyłka była trzeciego maja dwa tysiące dwudziestego piątego roku.'],
    ['To było w 2025 roku.', 'To było w dwa tysiące dwudziestym piątym roku.'],
    ['Stan na 2000 r.', 'Stan na dwutysięcznego roku.'],
    ['To były lata 90. w Polsce.', 'To były lata dziewięćdziesiąte w Polsce.'],
    ['W latach 80. tak było.', 'W latach osiemdziesiątych tak było.'],
  ])('reads dates: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Zaczynamy o 14:30.', 'Zaczynamy o czternastej trzydzieści.'],
    ['Budzik dzwoni o 8:05.', 'Budzik dzwoni o ósmej zero pięć.'],
    ['Jest 9:00.', 'Jest dziewiąta.'],
    ['Czekam przed 14:30.', 'Czekam przed czternastą trzydzieści.'],
  ])('reads times: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Trasa ma 5 km.', 'Trasa ma pięć kilometrów.'],
    ['Walizka waży 3 kg.', 'Walizka waży trzy kilogramy.'],
    ['Plik ma 120 MB.', 'Plik ma sto dwadzieścia megabajtów.'],
    ['Dysk ma 1 GB.', 'Dysk ma jeden gigabajt.'],
    ['Jest 20°C.', 'Jest dwadzieścia stopni Celsjusza.'],
    ['W nocy -5 stopni.', 'W nocy minus pięć stopni.'],
    ['Jechał 50 km/h.', 'Jechał pięćdziesiąt kilometrów na godzinę.'],
    ['Zajęło 250 ms.', 'Zajęło dwieście pięćdziesiąt milisekund.'],
    ['Trwało 5 min.', 'Trwało pięć minut.'],
    ['Trwało 2 min i 3 s.', 'Trwało dwie minuty i trzy sekundy.'],
    ['Przeszedł 2,5 km.', 'Przeszedł dwa i pół kilometra.'],
  ])('reads units: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Zajął 2. miejsce.', 'Zajął drugie miejsce.'],
    ['To jest 3. wersja.', 'To jest trzecia wersja.'],
    ['To jest 21. test.', 'To jest dwudziesty pierwszy test.'],
  ])('reads ordinals: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Wersja 2.0 jest gotowa.', 'Wersja dwa kropka zero jest gotowa.'],
    ['Wersja v1.2.3 trafiła tu.', 'Wersja jeden kropka dwa kropka trzy trafiła tu.'],
    ['Wydaliśmy v1.2.3 wczoraj.', 'Wydaliśmy wersję jeden kropka dwa kropka trzy wczoraj.'],
    ['Paczka 0.46.0 działa.', 'Paczka zero kropka czterdzieści sześć kropka zero działa.'],
  ])('reads versions: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Lubię owoce, np. jabłka, gruszki itd.', 'Lubię owoce, na przykład jabłka, gruszki i tak dalej.'],
    ['Dr Kowalski mieszka przy ul. Długiej 5.', 'Doktor Kowalski mieszka przy ulicy Długiej pięć.'],
    ['Zadanie nr 7, pkt 3.', 'Zadanie numer siedem, punkt trzy.'],
    ['Testy obejmują m.in. logowanie.', 'Testy obejmują między innymi logowanie.'],
    ['Trwało to ok. 5 min.', 'Trwało to około pięć minut.'],
    ['To tzw. test, tj. próba.', 'To tak zwany test, to jest próba.'],
    ['No ok. Dzięki.', 'No ok. Dzięki.'],
    ['Plan: 3 pkt do końca.', 'Plan: trzy punkty do końca.'],
  ])('reads abbreviations: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Napisz na jan@example.com teraz.', 'Napisz na jan małpa example kropka com teraz.'],
    ['Sprawa #123 czeka.', 'Sprawa numer sto dwadzieścia trzy czeka.'],
    ['Język C++ oraz A&B.', 'Język ce plus plus oraz A i B.'],
    ['Zadzwoń na +48 500 600 700.', 'Zadzwoń na cztery osiem pięć zero zero sześć zero zero siedem zero zero.'],
    ['Ekran ma 16:9 i 1920x1080.', 'Ekran ma szesnaście na dziewięć i tysiąc dziewięćset dwadzieścia na tysiąc osiemdziesiąt.'],
    ['Czekam 5-10 minut.', 'Czekam pięć do dziesięć minut.'],
    ['Wynik 10 - 5 = 5.', 'Wynik dziesięć minus pięć równa się pięć.'],
    ['Zajmie ~5 min.', 'Zajmie około pięć minut.'],
  ])('reads symbols: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Używamy API, URL, AI, USB i CPU.', 'Używamy a pe i, u er el, a i, u es be i ce pe u.'],
    ['Plik PDF przez HTTP.', 'Plik pe de ef przez ha te te pe.'],
    ['Dane z NASA.', 'Dane z NASA.'],
    ['To jest BARDZO ważne.', 'To jest BARDZO ważne.'],
    ['NIE rób tego.', 'NIE rób tego.'],
    ['Model GPT-4 działa.', 'Model gie pe te cztery działa.'],
    ['Nagranie MP3 w 4K.', 'Nagranie em pe trzy w cztery ka.'],
  ])('reads acronyms: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Jan III Sobieski żył w XVII wieku.', 'Jan Trzeci Sobieski żył w siedemnastym wieku.'],
    ['To jest rozdział IV.', 'To jest rozdział czwarty.'],
    ['Budowla z XV wieku.', 'Budowla z piętnastego wieku.'],
    ['I wtedy poszedł.', 'I wtedy poszedł.'],
  ])('reads Roman numerals: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it.each([
    ['Otwórz pipeline w repozytorium.', 'Otwórz pajplajn w repozytorium.'],
    ['Otwórz plik package.json i uruchom pnpm test.', 'Otwórz plik pakedż kropka dżejson i uruchom pe en pe em test.'],
    ['Zrób commit i push na GitHub.', 'Zrób komit i pusz na githab.'],
    ['Serwer zwraca JSON.', 'Serwer zwraca dżejson.'],
    ['Wyślij pull request do brancha development.', 'Wyślij pul rikłest do brancza development.'],
    ['Ten feature wymaga refactoringu.', 'Ten ficzer wymaga refaktoringu.'],
    ['OpenAI ma swoje modele.', 'ołpen ej aj ma swoje modele.'],
  ])('respells English terms the Polish reading gets wrong: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'pl')).toBe(spoken);
  });

  it('leaves plain Polish alone', () => {
    const plain = 'Dzień dobry, sprawdzam jak brzmi polski tekst w tej aplikacji.';
    expect(normalizeForSpeech(plain, 'pl')).toBe(plain);
  });
});

describe('normalizeForSpeech: English', () => {
  it.each([
    ['There are 4382 tests.', 'There are four thousand three hundred eighty two tests.'],
    ['We have 1,250 users.', 'We have one thousand two hundred fifty users.'],
    ['It costs $1,500.', 'It costs one thousand five hundred dollars.'],
    ['It costs $1.', 'It costs one dollar.'],
    ['It costs €15.99.', 'It costs fifteen euros ninety nine cents.'],
    ['The budget is $2.5 million.', 'The budget is two point five million dollars.'],
    ['Coverage is about 10%.', 'Coverage is about ten percent.'],
    ['Half is 1/2 and 2+2=4.', 'Half is one half and two plus two equals four.'],
    ['Take 3/4 of it.', 'Take three quarters of it.'],
    ['It runs 24/7.', 'It runs twenty four seven.'],
    ['The release is on 2026-03-01.', 'The release is on March first, twenty twenty six.'],
    ['Meet me on Jan. 5, 2026.', 'Meet me on January fifth, twenty twenty six.'],
    ['It shipped in 2026.', 'It shipped in twenty twenty six.'],
    ['It shipped in 2005.', 'It shipped in two thousand five.'],
    ['Meet at 5:30 PM.', 'Meet at five thirty pee em.'],
    ['The call is at 09:15.', 'The call is at nine fifteen.'],
    ['The call is at 8:05.', 'The call is at eight oh five.'],
    ['Lunch at 12:00.', "Lunch at twelve o'clock."],
    ['It used 120 MB of memory.', 'It used one hundred twenty megabytes of memory.'],
    ['It weighs 1 kg.', 'It weighs one kilogram.'],
    ['She drove at 50 km/h.', 'She drove at fifty kilometers per hour.'],
    ['It is 20°C outside.', 'It is twenty degrees Celsius outside.'],
    ['She came 3rd.', 'She came third.'],
    ['This is the 21st build.', 'This is the twenty first build.'],
    ['The build took 3.5 seconds.', 'The build took three point five seconds.'],
    ['Version v1.2.3 is out.', 'Version one point two point three is out.'],
    ['Dr. Smith vs. Mr. Jones.', 'Doctor Smith versus Mister Jones.'],
    ['Use a helper, e.g. this one.', 'Use a helper, for example this one.'],
    ['Write to jan@example.com about #123.', 'Write to jan at example dot com about number one hundred twenty three.'],
    ['We use C++ and A&B.', 'We use see plus plus and A and B.'],
    ['We use API, URL and CPU.', 'We use ay pee eye, you ar el and see pee you.'],
    ['The server returns JSON over HTTP.', 'The server returns jason over aitch tee tee pee.'],
    ['King Henry VIII lived in the XVI century.', 'King Henry the Eighth lived in the sixteenth century.'],
    ['It is -5 outside.', 'It is minus five outside.'],
    ['Zero is 0.', 'Zero is zero.'],
  ])('reads %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'en')).toBe(spoken);
  });

  it.each([
    ['Screen is 16:9.', 'Screen is sixteen by nine.'],
    ['It was the 1990s.', 'It was the nineteen nineties.'],
    ['Back in the 80s.', 'Back in the eighties.'],
    ['Wait 5-10 minutes.', 'Wait five to ten minutes.'],
    ['It takes ~5 min.', 'It takes about five minutes.'],
    ['World War II ended.', 'World War two ended.'],
    ['Call +48 500 600 700.', 'Call four eight five zero zero six zero zero seven zero zero.'],
    ['That is the plan, etc.', 'That is the plan, et cetera.'],
    ['Got $5k for it.', 'Got five thousand dollars for it.'],
  ])('reads edge cases: %s', (input, spoken) => {
    expect(normalizeForSpeech(input, 'en')).toBe(spoken);
  });

  it('leaves plain English alone', () => {
    const plain = 'The task is finished and every test passes.';
    expect(normalizeForSpeech(plain, 'en')).toBe(plain);
  });
});

describe('normalizeForSpeech: every language', () => {
  it('never leaves a digit in the corpus', () => {
    for (const { text, lang } of PRONUNCIATION_CORPUS) {
      expect(normalizeForSpeech(text, lang)).not.toMatch(/\d/);
    }
  });

  it.each(['abc123def', 'a26d45f7', 'x9', '12ab34', '1.2.3.4.5', '10.0.0.1', '#42a', '٣', '1e9'])(
    'never leaves a digit in the odd token %s',
    (token) => {
      expect(normalizeForSpeech(`Sprawdź ${token} teraz.`, 'pl')).not.toMatch(/[0-9]/);
      expect(normalizeForSpeech(`Check ${token} now.`, 'en')).not.toMatch(/[0-9]/);
    },
  );

  it('drops tags so the model never reads them out', () => {
    expect(normalizeForSpeech('To było zabawne! <laugh> Naprawdę.', 'pl')).toBe('To było zabawne! Naprawdę.');
    expect(normalizeForSpeech('Hello <en>there</en> friend.', 'en')).toBe('Hello there friend.');
  });

  it('keeps comparisons that only look like tags', () => {
    expect(normalizeForSpeech('If a < b then stop.', 'en')).toBe('If a < b then stop.');
  });

  it('only cleans the tags of a language it has no rules for', () => {
    expect(normalizeForSpeech('Das kostet <laugh> 5 Euro.', 'de')).toBe('Das kostet 5 Euro.');
  });
});
