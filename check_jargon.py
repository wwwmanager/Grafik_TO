import re
text = open('docs/manual.md', 'r', encoding='utf-8').read()
forbidden = ['парс', 'запрос', 'сервер', 'скрипт', 'CDN', 'API', 'localStorage', 'ArrayBuffer', 'CSP', 'index.html', 'npm', 'fetch', 'import', 'file://', 'модул', 'браузерн хранилищ', 'кэш']
for term in forbidden:
    matches = list(re.finditer(re.escape(term), text, re.IGNORECASE))
    if matches:
        print(f'FOUND "{term}": {len(matches)} hits')
        for m in matches:
            start = max(0, m.start()-40)
            end = min(len(text), m.end()+40)
            print(f'  ...{text[start:end]}...')
    else:
        print(f'OK: "{term}" not found')