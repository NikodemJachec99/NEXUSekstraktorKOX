Zaawansowany Ekstraktor Danych z Dokumentów
1. Cel Systemu
Ekstraktor jest wyspecjalizowanym narzędziem backendowym, zaprojektowanym do przetwarzania dużych zbiorów dokumentów (do 500 plików na raz) w celu dogłębnej analizy i ekstrakcji ustrukturyzowanych danych. System został zoptymalizowany pod kątem obsługi skomplikowanych spraw prawno-detektywistycznych, w szczególności dotyczących oszustw finansowych.

Kluczowe technologie to Node.js z frameworkiem Express.js, a sercem analizy są modele Google Gemini (dla analizy treści) oraz Google Cloud Vision AI (do odczytywania tekstu z obrazów i PDF-ów – OCR).

2. Architektura: Map-Reduce
Aby poradzić sobie z potencjalnie ogromną ilością danych (setki plików), system działa w oparciu o architekturę Map-Reduce. To podejście dzieli jeden duży problem ("przeanalizuj 100 plików") na wiele małych, równoległych zadań, a na końcu łączy wyniki w jedną, spójną całość.

Proces składa się z dwóch głównych faz: MAP i REDUCE.

3. Szczegółowy Przebieg Procesu
Oto jak krok po kroku dane przechodzą przez system, od zapytania z n8n do finalnej odpowiedzi.

Etap 0: Wejście – Zapytanie z n8n
Wszystko zaczyna się, gdy Twój workflow n8n wysyła zapytanie POST na endpoint /extract-invoice serwera. To zapytanie musi zawierać:

inputs: Tablica obiektów JSON, gdzie każdy obiekt reprezentuje jeden plik i ma strukturę {"type": "url", "name": "nazwa_pliku.pdf", "content": "link_do_pobrania"}.
prompt: Główny, finalny prompt dla etapu REDUCE. Mówi on AI, jak ma wyglądać ostateczny raport.
jsonSchema: Schemat JSON dla ostatecznego raportu. Wymusza na AI zwrot danych w precyzyjnie określonej strukturze.
model (opcjonalne): Nazwa modelu Gemini do użycia (np. gemini-1.5-pro-latest). Domyślnie gemini-2.0-flash.
promptPerPlik (opcjonalne): Specjalny prompt dla etapu MAP. Jeśli go podasz, będzie używany do analizy każdego pliku z osobna. Jeśli nie, użyty zostanie domyślny, szczegółowy prompt zdefiniowany w kodzie.
Etap 1: Inicjalizacja i Przetwarzanie Paczkowe
Gdy serwer odbiera zapytanie, w pliku extractInvoice.service.js:

Logowanie Konfiguracji: Na samym początku serwer loguje w konsoli, jakiego modelu AI i jakiego promptu dla etapu MAP użyje.
Tworzenie Kolejki Zadań: Wszystkie pliki z inputs są umieszczane na liście filesToProcess.
Ograniczenie Równoległości (Throttling): Aby uniknąć błędów 429 Too Many Requests z API Google, system nie przetwarza wszystkich plików na raz. Dzieli listę filesToProcess na małe paczki (domyślnie po 40 plików, zgodnie ze stałą CONCURRENT_MAP_LIMIT) i przetwarza je sekwencyjnie, jedna paczka po drugiej. Pliki wewnątrz jednej paczki są jednak przetwarzane równolegle.
Etap 2: Faza MAP – Analiza Pojedynczych Plików
Dla każdego pliku w bieżącej paczce wykonywane są następujące kroki:

Pobieranie Pliku: Funkcja downloadWithRetry z fileUtils.js pobiera plik z linku SharePoint. W razie problemów z siecią, ponowi próbę 3 razy.
Rozpoznawanie Typu Pliku:
Biblioteka file-type analizuje pierwsze bajty pliku, aby odgadnąć jego typ MIME (np. application/pdf).
Jeśli typ jest nieznany (undefined) lub ogólny (application/octet-stream), kod dodatkowo sprawdza rozszerzenie w nazwie pliku (.pdf, .docx, .jpg etc.), aby spróbować poprawnie zidentyfikować plik.
Ekstrakcja Treści (w zależności od typu):
PDF (.pdf): Plik jest przekazywany do convertPdfToAllImageBuffers (convertPdfPageToImageBuffer.js), która używa narzędzia pdftocairo (z pakietu Poppler) do konwersji każdej strony PDF na osobny obraz w formacie PNG.
Obrazy (.jpg, .png, etc.): Plik jest traktowany jako pojedynczy obraz.
Word (.docx): Używana jest biblioteka mammoth do wyciągnięcia czystego tekstu z dokumentu.
E-mail (.msg): Biblioteka @kenjiuno/msgreader parsuje plik, a skrypt wyciąga z niego nagłówki (Od, Do, Temat) oraz treść, tworząc sformatowany tekst.
OpenDocument (.odt): Biblioteka unzipper rozpakowuje plik, a xml2js parsuje wewnętrzny plik content.xml, z którego wyciągany jest tekst.
OCR (dla obrazów i PDF):
Jeśli w poprzednim kroku powstały obrazy, każdy z nich jest wysyłany do Google Cloud Vision API za pomocą funkcji detectTextInImageBuffer w visionUtils.js.
Vision API wykonuje optyczne rozpoznawanie znaków (OCR) i zwraca tekst znaleziony na obrazie.
Przygotowanie i Wywołanie AI (MAP):
Tekst z OCR lub z plików .docx/.msg/.odt jest łączony.
Szablon mapPromptTemplate jest uzupełniany o nazwę pliku w miejscu znacznika __FILENAME__.
Funkcja callGemini (geminiUtils.js) jest wywoływana z:
Gotowym, spersonalizowanym promptem.
Obrazami (jeśli były).
Wybranym modelem.
Schematem INTERMEDIATE_SCHEMA (zmuszającym AI do zwrotu ustrukturyzowanego streszczenia).
Wyekstrahowanym tekstem.
Wynik Fazy MAP: Dla każdego pomyślnie przetworzonego pliku, AI zwraca obiekt JSON z jego szczegółowym streszczeniem.
Etap 3: Faza REDUCE – Synteza Raportu Końcowego
Agregacja Danych: Po zakończeniu przetwarzania wszystkich paczek, system zbiera wszystkie udane streszczenia JSON z etapu MAP do jednej dużej tablicy successfulSummaries.
Przygotowanie Finalnego Kontekstu: Tworzony jest jeden, wielki "wirtualny dokument". Składa się on z głównego promptu (przekazanego z n8n) oraz całej tablicy streszczeń przekonwertowanej na tekst (JSON.stringify).
Wywołanie AI (REDUCE): Funkcja callGemini jest wywoływana jeden ostatni raz z:
Głównym promptem i zagregowanymi danymi.
Wybranym modelem.
Finalnym schematem jsonSchema (przekazanym z n8n).
Wynik Końcowy: AI, mając teraz pełen obraz sprawy (dzięki wszystkim streszczeniom), generuje ostateczny, kompleksowy raport w formacie JSON, zgodny z Twoim finalnym schematem.
Etap 4: Wyjście – Odpowiedź do Webhooka
Wygenerowany w etapie REDUCE finalny obiekt JSON jest wysyłany na adres postUrl podany w zapytaniu, gdzie czeka na niego Twój drugi workflow n8n, gotowy do generowania profesjonalnych dokumentów .docx.

Konfiguracja i Uruchomienie
Zainstaluj zależności:
Bash

npm install
Utwórz plik .env w głównym folderze projektu z następującą zawartością:
Makefile

# Klucz do zabezpieczenia endpointów API
API_KEY=YOUR_CUSTOM_API_KEY

# Klucz do API generatywnego Google (Gemini)
GOOGLE_API_KEY=YOUR_GEMINI_API_KEY

# Dane logowania do Vision API (plik .json zakodowany w base64)
GOOGLE_CREDENTIALS=BASE64_ENCODED_GOOGLE_SERVICE_ACCOUNT_JSON

# Port, na którym działa serwer
PORT=3000
Uruchom serwer:
Bash

npm run start
Server będzie działał pod adresem http://localhost:3000. Dokumentacja API jest dostępna pod http://localhost:3000/api-docs.