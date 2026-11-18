from urllib.parse import unquote, urlparse, parse_qs

url = 'https://search.bilibili.com/video?vt=50461778&keyword=%23c%E5%90%9B&from_source=web_search'

# Simulate getRawSearchKeyword()
def get_raw_keyword(search, hash_val):
    kw = ''
    params = parse_qs(search.lstrip('?'))
    if 'keyword' in params:
        kw = params['keyword'][0]

    if hash_val:
        if 'keyword=' in hash_val:
            frag_qs = parse_qs(hash_val.split('?')[-1])
            if 'keyword' in frag_qs:
                kw = frag_qs['keyword'][0]
        elif not hash_val.startswith('#/') and not hash_val.startswith('#?'):
            frag = unquote(hash_val.lstrip('#')).strip()
            if frag:
                if kw:
                    kw = unquote(kw.replace('+', ' ')) + ' #' + frag
                else:
                    kw = '#' + frag

    try:
        return unquote(kw.replace('+', ' ')).strip()
    except:
        return kw

u = urlparse(url)
raw_kw = get_raw_keyword(u.query, u.fragment)
print('raw_kw:', raw_kw)

# Simulate getSearchKeywords()
def clean_text(s):
    return s.strip().lower()

list_words = clean_text(raw_kw).split()
normal = []
triple = []
exclude = []
tags = []
ups = []

for k in list_words:
    if k.startswith('-') and len(k) > 1:
        exclude.append(k[1:])
    elif k.startswith('*') and len(k) > 1:
        triple.append(k[1:])
    elif k.startswith('#') and len(k) > 1:
        tags.append(k[1:])
    elif k.startswith('@') and len(k) > 1:
        ups.append(k[1:])
    elif k:
        normal.append(k)

filters = {
    'normal': normal,
    'triple': triple,
    'exclude': exclude,
    'tags': tags,
    'ups': ups,
    'hasRules': bool(normal or triple or exclude or tags or ups)
}

print('filters:', filters)

# Now checkVideoMatch
def check_video_match(title_raw, tags_raw, author_raw, f):
    title = clean_text(title_raw)
    tags = clean_text(tags_raw)
    author = clean_text(author_raw)

    if f['exclude'] and any(k in title for k in f['exclude']): return False
    if f['normal'] and not all(k in title for k in f['normal']): return False
    if f['triple'] and not all(k in title or k in tags or k in author for k in f['triple']): return False
    if f['tags'] and not all(k in tags for k in f['tags']): return False
    if f['ups'] and not any(k in author for k in f['ups']): return False
    return True

# Typical videos on Bilibili search page for #c君:
# Video 1: by 渗透之C君
v1_title = "【渗透之C君】生化危机4重制版解说P1"
v1_author = "渗透之C君"
v1_tags_from_dom = "" # Notice DOM does NOT have tags!
v1_tags_from_map = "" # If videoTagMap is empty on initial load!

print('v1 without videoTagMap match?:', check_video_match(v1_title, v1_tags_from_map, v1_author, filters))

v1_tags_with_tag = "单机游戏,实况,解说,生化危机" # Notice: even if tag API returned, does it contain 'c君'?
print('v1 with typical tags (no c君 in tag) match?:', check_video_match(v1_title, v1_tags_with_tag, v1_author, filters))

v1_tags_with_cjun = "单机游戏,实况,解说,c君"
print('v1 with c君 tag match?:', check_video_match(v1_title, v1_tags_with_cjun, v1_author, filters))
