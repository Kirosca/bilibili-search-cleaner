from urllib.parse import unquote

def get_raw_keyword(search, hash_val, dom_val=''):
    kw = ''
    if 'keyword=' in search:
        for part in search.lstrip('?').split('&'):
            if part.startswith('keyword='):
                kw = part.split('=', 1)[1]
                break

    if hash_val:
        if 'keyword=' in hash_val:
            for part in hash_val.split('?')[-1].split('&'):
                if part.startswith('keyword='):
                    kw = part.split('=', 1)[1]
                    break
        elif not hash_val.startswith('#/') and not hash_val.startswith('#?'):
            frag = unquote(hash_val[1:]).strip()
            if frag:
                if kw:
                    kw = unquote(kw.replace('+', ' ')) + ' #' + frag
                else:
                    kw = '#' + frag

    if dom_val and any(c in dom_val for c in ['#', '@', '-', '*']):
        kw = dom_val

    try:
        return unquote(kw.replace('+', ' ')).strip()
    except:
        return kw

print('1. Encoded hash (?keyword=python+%23tag):', get_raw_keyword('?keyword=python+%23tag', ''))
print('2. Unencoded hash after F5 (?keyword=python, #tag):', get_raw_keyword('?keyword=python', '#tag'))
print('3. Solo unencoded hash (?keyword=, #tag):', get_raw_keyword('?keyword=', '#tag'))
print('4. Solo encoded hash (?keyword=%23tag):', get_raw_keyword('?keyword=%23tag', ''))
print('5. Normal with - and @ (?keyword=python+-@up):', get_raw_keyword('?keyword=python+-@up', ''))
print('6. DOM fallback (?keyword=python, DOM="python #tag"):', get_raw_keyword('?keyword=python', '', 'python #tag'))
