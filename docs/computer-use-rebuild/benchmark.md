# Benchmark Computer Use

## Próg (ustalony w planie przed pomiarem)

- co najmniej 90% zadań zakończonych sukcesem,
- 0 fałszywych sukcesów (agent mówi „zrobione”, a stan aplikacji jest inny).

Sukces ocenia się po prawdziwym stanie aplikacji odczytanym niezależnie
(System Events / `osascript`), nigdy po odpowiedzi agenta.

## Zestaw zadań

| # | Obszar | Zadanie | Aplikacja |
|---|---|---|---|
| 1 | formularz | wpisz „Kamil” w pole Name, naciśnij Press 2 razy, podaj status | fixture |
| 2 | montaż (bez AX) | przesuń klip B w lewo na osi czasu, podaj etykietę | fixture |
| 3 | montaż (bez AX) | przytnij klip A z prawej krawędzi | fixture |
| 4 | kalkulator | policz 17 × 23 przyciskami | Kalkulator |
| 5 | edytor | nowy dokument, wpisz tekst z polskimi znakami, nie zapisuj | TextEdit |
| 6 | Finder | utwórz folder w katalogu tymczasowym i zmień mu nazwę | Finder |
| 7 | przeglądarka | odczytaj tytuł otwartej strony (poziom `read`) | Safari |
| 8 | pakiet biurowy | wpisz trzy wartości i sumę w arkuszu | Numbers |
| 9 | montaż | przytnij klip, przesuń go, wyeksportuj | realna aplikacja montażowa |
| 10 | odporność | modal, przesunięcie układu, kontrolka bez efektu, Stop/Przejmij | fixture |

## Wynik (2026-10-01, macOS, CLI `moxxy -p`, dostawca `openai-codex`, model `gpt-6-astra`)

| Próba | Zadanie | Wynik | Stan sprawdzony niezależnie |
|---|---|---|---|
| run4 | 1 | porażka — każde kliknięcie odrzucone przez schemat | pole „Kamil”, status „Ready” |
| run5 | 1 | sukces po poprawce (5 wywołań, 60 s) | „Kamil”, „Pressed 2” |
| run6 | 2 | sukces (3 wywołania, 40 s) | „Timeline A 20+80 B 110+60 selected B” |
| run7 | 4 | sukces (8 wywołań, 91 s) | wyświetlacz „391” |
| run8 | 5 | porażka — aplikacja bez okna nie przyjęła ⌘N; agent zgłosił to uczciwie | brak dokumentu |
| run9 | 5 | nierozstrzygnięta — limit użycia konta dostawcy (429) po 2 wywołaniach | — |

Fałszywych sukcesów: 0 (w obu porażkach agent powiedział, że zadanie się nie
udało).

Zadanie 5 po poprawce sprawdzono bez modelu, wywołując narzędzia pluginu na
prawdziwym TextEdit (`request_access` → `get_app_state` → `press_key super+n` →
`type_text`): dokument zawiera „Zażółć gęślą jaźń 123.”.

## Błędy znalezione w próbach i naprawione

1. Model wypełnia nieużywane pola (`x: 0, y: 0, modifiers: ""`, `null`) i
   schemat odrzucał wywołanie, aż pętla przerwała turę. Schemat traktuje teraz
   taki wypełniacz jak brak pola (`contract/tools.ts`).
2. Aplikacja bez otwartego okna nie przyjmowała klawiszy. Klawisze idą teraz do
   procesu aplikacji, a dla skrótów ⌘ aplikacja jest wyciągana na wierzch także
   bez okna.
3. Działająca aplikacja pokazywana pod przetłumaczoną nazwą („Kalkulator”) nie
   była znajdowana po nazwie pakietu („Calculator”).

## Czego nie zmierzono

- Próg 90% nie jest potwierdzony: po poprawkach są 3 rozstrzygnięte próby z
  modelem (3 sukcesy) — za mało, żeby mówić o odsetku.
- Zadania 3, 6, 7, 8 i 9 nie były uruchomione z modelem (limit konta dostawcy).
  Zadanie 3 i scenariusze z zadania 10 są pokryte testami end-to-end helpera
  (`src/macos/helper.test.ts`), czyli bez modelu.
- Realna aplikacja montażowa (zadanie 9) nie jest zainstalowana na tej maszynie.
- Windows: tylko testy na runnerze CI, bez prób z modelem.
- Powtórzenia tego samego zadania (rozrzut wyników) nie były robione.

## Jak powtórzyć

Aplikacja testowa: `native/macos/build-fixture.sh`, potem
`open -g native/macos/.build/fixture/MoxxyComputerFixture.app`. Zadanie:
`node packages/cli/dist/bin.js -p "<zadanie>" --allow-tools <narzędzia computer_*> --output-format stream-json < /dev/null`.
Starsza kopia pluginu w `~/.moxxy/plugins` ma pierwszeństwo przed kopią z
repozytorium, więc na czas próby trzeba ją odsunąć.
